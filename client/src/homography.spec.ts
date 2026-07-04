/// <reference types="vitest" />
import {
  solveHomography,
  applyHomography,
  invert3,
  matMul3,
  subdivideWarpQuads,
  warpGridSize,
  Point,
  Matrix3,
} from './homography';

function expectMatrixClose(actual: Matrix3, expected: Matrix3, tol = 1e-6) {
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      expect(actual[i][j]).toBeCloseTo(expected[i][j], 5);
      // tol referenced to keep signature explicit
      expect(Math.abs(actual[i][j] - expected[i][j])).toBeLessThan(tol * 10);
    }
  }
}

const unitSquare: Point[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

describe('homography', () => {
  it('recovers the identity from identical correspondences', () => {
    const H = solveHomography(unitSquare, unitSquare);
    expectMatrixClose(H, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  });

  it('recovers a pure translation', () => {
    const dst = unitSquare.map(([x, y]): Point => [x + 5, y - 3]);
    const H = solveHomography(unitSquare, dst);
    expectMatrixClose(H, [[1, 0, 5], [0, 1, -3], [0, 0, 1]]);
  });

  it('recovers a scale + translation', () => {
    const H = solveHomography(unitSquare, [[10, 10], [30, 10], [30, 30], [10, 30]]);
    expectMatrixClose(H, [[20, 0, 10], [0, 20, 10], [0, 0, 1]]);
  });

  it('maps source points onto destination points (least-squares, >4 pts)', () => {
    // A known projective transform applied to 5 points; solver should recover it.
    const truth: Matrix3 = [[1.2, 0.1, 5], [0.05, 0.9, -4], [0.0008, -0.0005, 1]];
    const src: Point[] = [[0, 0], [100, 0], [100, 80], [0, 80], [50, 40]];
    const dst = src.map((p) => applyHomography(truth, p));
    const H = solveHomography(src, dst);
    src.forEach((p) => {
      const [u, v] = applyHomography(H, p);
      const [eu, ev] = applyHomography(truth, p);
      expect(u).toBeCloseTo(eu, 3);
      expect(v).toBeCloseTo(ev, 3);
    });
  });

  it('round-trips through its inverse (H * H^-1 ~= I)', () => {
    const H = solveHomography(unitSquare, [[10, 5], [40, 8], [38, 35], [9, 33]]);
    const product = matMul3(H, invert3(H));
    const scale = 1 / product[2][2];
    const normalized = product.map((r) => r.map((c) => c * scale)) as Matrix3;
    expectMatrixClose(normalized, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  });

  it('throws with fewer than 4 correspondences', () => {
    expect(() => solveHomography(unitSquare.slice(0, 3), unitSquare.slice(0, 3))).toThrow();
  });

  it('throws on a degenerate (collinear) point configuration despite having 4 points', () => {
    const collinear: Point[] = [[0, 0], [1, 0], [2, 0], [3, 0]];
    expect(() => solveHomography(collinear, collinear)).toThrow(/degenerate/i);
  });
});

describe('warpGridSize', () => {
  const affine: Matrix3 = [[1.5, 0.2, 30], [-0.1, 0.9, -12], [0, 0, 1]];
  const projective: Matrix3 = [[1.2, 0.1, 5], [0.05, 0.9, -4], [0.0008, -0.0005, 1]];

  it('returns 1 for a pure affine transform', () => {
    expect(warpGridSize(affine, 640, 480)).toBe(1);
  });

  it('returns maxN when perspective terms are non-negligible', () => {
    expect(warpGridSize(projective, 640, 480)).toBe(8);
    expect(warpGridSize(projective, 640, 480, 12)).toBe(12);
  });

  it('returns 1 for negligible perspective terms', () => {
    // Perspective terms exist but vary w by only ~0.006% over the extent.
    const nearAffine: Matrix3 = [[1.2, 0.1, 5], [0.05, 0.9, -4], [1e-7, 0, 1]];
    expect(warpGridSize(nearAffine, 640, 480)).toBe(1);
  });

  it('returns maxN when the horizon crosses the image (w changes sign)', () => {
    const extreme: Matrix3 = [[1, 0, 0], [0, 1, 0], [-0.01, 0, 1]];
    // w at x=0 is 1, at x=640 is -5.4.
    expect(warpGridSize(extreme, 640, 480)).toBe(8);
  });
});

describe('subdivideWarpQuads', () => {
  const projective: Matrix3 = [[1.2, 0.1, 5], [0.05, 0.9, -4], [0.0008, -0.0005, 1]];

  it('with n=1 produces a single quad matching the full image corners', () => {
    const [quad, ...rest] = subdivideWarpQuads(projective, 640, 480, 1);
    expect(rest).toHaveLength(0);
    expect(quad.crop).toEqual({
      left: 0, top: 0, right: 640, bottom: 480,
    });
    expect(quad.ul).toEqual(applyHomography(projective, [0, 0]));
    expect(quad.ur).toEqual(applyHomography(projective, [640, 0]));
    expect(quad.lr).toEqual(applyHomography(projective, [640, 480]));
    expect(quad.ll).toEqual(applyHomography(projective, [0, 480]));
  });

  it('maps every sub-quad corner through the exact homography', () => {
    const n = 8;
    const quads = subdivideWarpQuads(projective, 640, 480, n);
    expect(quads).toHaveLength(n * n);
    quads.forEach((q) => {
      expect(q.ul).toEqual(applyHomography(projective, [q.crop.left, q.crop.top]));
      expect(q.ur).toEqual(applyHomography(projective, [q.crop.right, q.crop.top]));
      expect(q.lr).toEqual(applyHomography(projective, [q.crop.right, q.crop.bottom]));
      expect(q.ll).toEqual(applyHomography(projective, [q.crop.left, q.crop.bottom]));
    });
  });

  it('tiles the source image exactly, with integer grid lines and no gaps', () => {
    const n = 8;
    const width = 641; // not divisible by n
    const height = 479;
    const quads = subdivideWarpQuads(projective, width, height, n);
    const lefts = new Set(quads.map((q) => q.crop.left));
    const tops = new Set(quads.map((q) => q.crop.top));
    expect(lefts.size).toBe(n);
    expect(tops.size).toBe(n);
    quads.forEach((q) => {
      [q.crop.left, q.crop.top, q.crop.right, q.crop.bottom].forEach((v) => {
        expect(Number.isInteger(v)).toBe(true);
      });
      expect(q.crop.right).toBeGreaterThan(q.crop.left);
      expect(q.crop.bottom).toBeGreaterThan(q.crop.top);
      // Each cell's right/bottom edge is another cell's left/top edge or the border.
      expect(q.crop.right === width || lefts.has(q.crop.right)).toBe(true);
      expect(q.crop.bottom === height || tops.has(q.crop.bottom)).toBe(true);
    });
    // Crop areas sum to the full image area (exact tiling, no overlap/gap).
    const area = quads.reduce(
      (sum, q) => sum + (q.crop.right - q.crop.left) * (q.crop.bottom - q.crop.top),
      0,
    );
    expect(area).toBe(width * height);
  });

  it('skips degenerate zero-area cells for images smaller than the grid', () => {
    const quads = subdivideWarpQuads(projective, 3, 3, 8);
    expect(quads.length).toBeGreaterThan(0);
    quads.forEach((q) => {
      expect(q.crop.right).toBeGreaterThan(q.crop.left);
      expect(q.crop.bottom).toBeGreaterThan(q.crop.top);
    });
    const area = quads.reduce(
      (sum, q) => sum + (q.crop.right - q.crop.left) * (q.crop.bottom - q.crop.top),
      0,
    );
    expect(area).toBe(9);
  });

  it('sub-quad centers stay close to the true projective warp (approximation quality)', () => {
    // The deviation between the piecewise-affine render and the true warp is
    // largest in cell interiors; measure it at the center of every cell as the
    // distance between the true projective warp of the cell's source center
    // and the average of the four warped corners (what an affine-ish renderer
    // produces there).
    const width = 640;
    const height = 480;
    const centerError = (quads: ReturnType<typeof subdivideWarpQuads>) => Math.max(
      ...quads.map((q) => {
        const midSrc: Point = [
          (q.crop.left + q.crop.right) / 2,
          (q.crop.top + q.crop.bottom) / 2,
        ];
        const truth = applyHomography(projective, midSrc);
        const approx: Point = [
          (q.ul[0] + q.ur[0] + q.lr[0] + q.ll[0]) / 4,
          (q.ul[1] + q.ur[1] + q.lr[1] + q.ll[1]) / 4,
        ];
        return Math.hypot(approx[0] - truth[0], approx[1] - truth[1]);
      }),
    );
    const singleQuadError = centerError(subdivideWarpQuads(projective, width, height, 1));
    const gridError = centerError(subdivideWarpQuads(projective, width, height, 8));
    // This matrix has strong perspective: a single (parallelogram-rendered)
    // quad is tens of pixels off at the image center.
    expect(singleQuadError).toBeGreaterThan(10);
    // Error shrinks roughly with 1/n^2; at n=8 even this extreme perspective
    // (w varies ~2x across the image) is down to a couple of pixels.
    expect(gridError).toBeLessThan(3);
    expect(gridError).toBeLessThan(singleQuadError / 20);
  });
});
