/// <reference types="vitest" />
import {
  solveHomography,
  applyHomography,
  invert3,
  matMul3,
  subdivideWarpQuads,
  warpGridSize,
  geojsWarpQuads,
  geojsWarpQuadsForImage,
  localLinkedScale,
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

  it('expands cells by the overlap (clamped to the image), corners still exact', () => {
    const n = 4;
    const overlap = 2;
    const plain = subdivideWarpQuads(projective, 640, 480, n);
    const padded = subdivideWarpQuads(projective, 640, 480, n, overlap);
    expect(padded).toHaveLength(plain.length);
    padded.forEach((q, i) => {
      const base = plain[i].crop;
      expect(q.crop.left).toBe(Math.max(0, base.left - overlap));
      expect(q.crop.right).toBe(Math.min(640, base.right + overlap));
      expect(q.crop.top).toBe(Math.max(0, base.top - overlap));
      expect(q.crop.bottom).toBe(Math.min(480, base.bottom + overlap));
      // Corners remain the exact projective mapping of the (expanded) crop,
      // so overlapping regions of adjacent cells render identical content.
      expect(q.ul).toEqual(applyHomography(projective, [q.crop.left, q.crop.top]));
      expect(q.lr).toEqual(applyHomography(projective, [q.crop.right, q.crop.bottom]));
    });
    // Interior edges overlap: cell 0's right crop passes cell 1's left crop.
    expect(padded[0].crop.right).toBeGreaterThan(padded[1].crop.left);
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

describe('localLinkedScale', () => {
  const mapper = (matrix: Matrix3) => (p: Point) => applyHomography(matrix, p);

  it('returns 1 for the identity mapping', () => {
    const identity: Matrix3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    expect(localLinkedScale(mapper(identity), [100, 200])).toBeCloseTo(1);
  });

  it('recovers a uniform similarity scale regardless of rotation', () => {
    const s = 2.5;
    const cos = Math.cos(Math.PI / 6) * s;
    const sin = Math.sin(Math.PI / 6) * s;
    const similarity: Matrix3 = [[cos, -sin, 10], [sin, cos, -4], [0, 0, 1]];
    expect(localLinkedScale(mapper(similarity), [50, 75])).toBeCloseTo(s);
  });

  it('samples the local scale of a projective transform at the given point', () => {
    const homography: Matrix3 = [[1, 0, 0], [0, 1, 0], [0.001, 0, 1]];
    const nearOrigin = localLinkedScale(mapper(homography), [0, 0], 1);
    const farRight = localLinkedScale(mapper(homography), [500, 0], 1);
    expect(nearOrigin).toBeCloseTo(1, 1);
    // At x=500 the perspective divide (w = 1.5) has shrunk the local scale
    // well below 1; exact value differs per axis, so just assert the shrink.
    expect(farRight).not.toBeNull();
    expect(farRight as number).toBeLessThan(0.7);
  });

  it('returns null when the mapping is unavailable', () => {
    expect(localLinkedScale(() => null, [10, 10])).toBeNull();
  });

  it('returns null for a degenerate (collapsing) mapping', () => {
    expect(localLinkedScale(() => [3, 3], [10, 10])).toBeNull();
  });
});

describe('geojsWarpQuads', () => {
  it('maps an affine warp to a single geojs quad with a full-size crop stretch', () => {
    const translate: Matrix3 = [[1, 0, 5], [0, 1, -3], [0, 0, 1]];
    const [quad, ...rest] = geojsWarpQuads(translate, 640, 480);
    expect(rest).toHaveLength(0);
    expect(quad.ul).toEqual({ x: 5, y: -3 });
    expect(quad.lr).toEqual({ x: 645, y: 477 });
    // left/top/right/bottom select the cell's source region; x/y are the full
    // source size so that region stretches across the whole sub-quad.
    expect(quad.crop).toEqual({
      left: 0, top: 0, right: 640, bottom: 480, x: 640, y: 480,
    });
  });

  it('subdivides a projective warp and maps each corner through the homography', () => {
    const projective: Matrix3 = [[1.2, 0.1, 5], [0.05, 0.9, -4], [0.0008, -0.0005, 1]];
    const grid = warpGridSize(projective, 640, 480);
    const quads = geojsWarpQuads(projective, 640, 480);
    expect(quads).toHaveLength(grid * grid);
    quads.forEach((q) => {
      const [x, y] = applyHomography(projective, [q.crop.left, q.crop.top]);
      expect(q.ul).toEqual({ x, y });
      expect(q.crop.x).toBe(640);
      expect(q.crop.y).toBe(480);
    });
  });
});

describe('geojsWarpQuadsForImage', () => {
  it('leaves crops unchanged when the texture matches native dimensions', () => {
    const translate: Matrix3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const img = {
      naturalWidth: 640,
      naturalHeight: 480,
      width: 640,
      height: 480,
    } as HTMLImageElement;
    const [quad] = geojsWarpQuadsForImage(translate, {
      source: img,
      kind: 'image',
      width: 640,
      height: 480,
    });
    expect(quad.crop).toEqual({
      left: 0, top: 0, right: 640, bottom: 480, x: 640, y: 480,
    });
    expect(quad.image).toBe(img);
  });

  it('remaps crops into overview texture pixels for downsampled large-image canvases', () => {
    const translate: Matrix3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const canvas = {
      width: 2048,
      height: 1024,
    } as HTMLCanvasElement;
    // Native IR frame is 4x the overview texture on each axis.
    const [quad] = geojsWarpQuadsForImage(translate, {
      source: canvas,
      kind: 'image',
      width: 8192,
      height: 4096,
    });
    expect(quad.ul).toEqual({ x: 0, y: 0 });
    expect(quad.lr).toEqual({ x: 8192, y: 4096 });
    expect(quad.crop).toEqual({
      left: 0, top: 0, right: 2048, bottom: 1024, x: 2048, y: 1024,
    });
    expect(quad.image).toBe(canvas);
  });
});
