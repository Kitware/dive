/**
 * Self-contained homography estimation via the normalized Direct Linear Transform.
 *
 * Given >= 4 point correspondences src[i] -> dst[i] (both [x, y] in image
 * coordinates), {@link solveHomography} returns the 3x3 matrix H such that, in
 * homogeneous coordinates, dst ~= H * src. Exact for 4 points, least-squares for
 * more. This is the client-side analogue of OpenCV's cv2.findHomography used by
 * the keypointgui reference app; the warp itself is done by geojs (quadFeature).
 */

export type Point = [number, number];
export type Matrix3 = number[][];

/** Multiply two 3x3 matrices. */
export function matMul3(a: Matrix3, b: Matrix3): Matrix3 {
  const out: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) {
        sum += a[i][k] * b[k][j];
      }
      out[i][j] = sum;
    }
  }
  return out;
}

/** Invert a 3x3 matrix. Throws if the matrix is singular. */
export function invert3(m: Matrix3): Matrix3 {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) {
    throw new Error('Cannot invert singular matrix');
  }
  const invDet = 1 / det;
  return [
    [A * invDet, -(b * i - c * h) * invDet, (b * f - c * e) * invDet],
    [B * invDet, (a * i - c * g) * invDet, -(a * f - c * d) * invDet],
    [C * invDet, -(a * h - b * g) * invDet, (a * e - b * d) * invDet],
  ];
}

/** Apply a 3x3 homography to a single point (perspective divide). */
export function applyHomography(h: Matrix3, p: Point): Point {
  const x = h[0][0] * p[0] + h[0][1] * p[1] + h[0][2];
  const y = h[1][0] * p[0] + h[1][1] * p[1] + h[1][2];
  const w = h[2][0] * p[0] + h[2][1] * p[1] + h[2][2];
  return [x / w, y / w];
}

/**
 * Hartley normalization: translate points to the centroid and scale so the
 * mean distance from the origin is sqrt(2). Returns the normalized points and
 * the 3x3 transform T such that normalized = T * original.
 */
function normalizePoints(pts: Point[]): { normalized: Point[]; transform: Matrix3 } {
  const n = pts.length;
  let cx = 0;
  let cy = 0;
  pts.forEach(([x, y]) => { cx += x; cy += y; });
  cx /= n;
  cy /= n;
  let meanDist = 0;
  pts.forEach(([x, y]) => { meanDist += Math.hypot(x - cx, y - cy); });
  meanDist /= n;
  const scale = meanDist > 1e-12 ? Math.SQRT2 / meanDist : 1;
  const transform: Matrix3 = [
    [scale, 0, -scale * cx],
    [0, scale, -scale * cy],
    [0, 0, 1],
  ];
  const normalized = pts.map(([x, y]): Point => [(x - cx) * scale, (y - cy) * scale]);
  return { normalized, transform };
}

/**
 * Solve the linear system A x = b for x using Gaussian elimination with partial
 * pivoting. A is square (n x n), modified in place.
 */
/* eslint-disable no-param-reassign */
export function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let col = 0; col < n; col += 1) {
    // Partial pivot: find the row with the largest magnitude in this column.
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(A[pivot][col]) < 1e-12) {
      throw new Error('Degenerate point configuration; cannot solve homography');
    }
    if (pivot !== col) {
      [A[col], A[pivot]] = [A[pivot], A[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    // Eliminate below.
    for (let row = col + 1; row < n; row += 1) {
      const factor = A[row][col] / A[col][col];
      for (let k = col; k < n; k += 1) {
        A[row][k] -= factor * A[col][k];
      }
      b[row] -= factor * b[col];
    }
  }
  // Back-substitution.
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = b[row];
    for (let k = row + 1; k < n; k += 1) {
      sum -= A[row][k] * x[k];
    }
    x[row] = sum / A[row][row];
  }
  return x;
}
/* eslint-enable no-param-reassign */

/**
 * Estimate the homography H (dst ~= H * src) from >= 4 correspondences.
 *
 * Uses the h33 = 1 formulation in Hartley-normalized coordinates, solved via the
 * normal equations (least-squares for > 4 points, exact for 4). Normalization
 * keeps the system well-conditioned for typical image-pixel magnitudes.
 */
export function solveHomography(src: Point[], dst: Point[]): Matrix3 {
  if (src.length !== dst.length) {
    throw new Error('src and dst must have the same number of points');
  }
  if (src.length < 4) {
    throw new Error('At least 4 point correspondences are required');
  }

  const { normalized: srcN, transform: T1 } = normalizePoints(src);
  const { normalized: dstN, transform: T2 } = normalizePoints(dst);

  // Build the 2N x 8 design matrix for the unknowns [h11..h32] (h33 fixed to 1).
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < srcN.length; i += 1) {
    const [x, y] = srcN[i];
    const [u, v] = dstN[i];
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    rhs.push(v);
  }

  // Normal equations: (A^T A) h = A^T b  -> an 8x8 system.
  const ata: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const atb: number[] = new Array<number>(8).fill(0);
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    for (let i = 0; i < 8; i += 1) {
      atb[i] += row[i] * rhs[r];
      for (let j = 0; j < 8; j += 1) {
        ata[i][j] += row[i] * row[j];
      }
    }
  }

  const h = solveLinearSystem(ata, atb);
  const hNorm: Matrix3 = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];

  // Denormalize: H = inv(T2) * Hnorm * T1.
  const denorm = matMul3(matMul3(invert3(T2), hNorm), T1);

  // Scale so H[2][2] == 1 for a canonical form.
  const scale = Math.abs(denorm[2][2]) > 1e-12 ? 1 / denorm[2][2] : 1;
  return denorm.map((row) => row.map((value) => value * scale));
}
