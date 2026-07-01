/// <reference types="vitest" />
import {
  solveHomography,
  applyHomography,
  invert3,
  matMul3,
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
