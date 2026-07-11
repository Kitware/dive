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
 * Local scale factor of a point mapping around `center`: how many target-image
 * pixels one source-image pixel spans there, estimated by probing `delta`
 * pixels along each axis and averaging. For similarity/affine transforms this
 * is constant; for homographies it varies with position, which is why it's
 * sampled at a specific point (e.g. the current view center for linked
 * pan/zoom). Returns null when the mapping is unavailable or degenerate at
 * that point.
 */
export function localLinkedScale(
  mapPoint: (p: Point) => Point | null,
  center: Point,
  delta = 10,
): number | null {
  const mapped = mapPoint(center);
  const mappedX = mapPoint([center[0] + delta, center[1]]);
  const mappedY = mapPoint([center[0], center[1] + delta]);
  if (!mapped || !mappedX || !mappedY) {
    return null;
  }
  const scaleX = Math.hypot(mappedX[0] - mapped[0], mappedX[1] - mapped[1]) / delta;
  const scaleY = Math.hypot(mappedY[0] - mapped[0], mappedY[1] - mapped[1]) / delta;
  const scale = (scaleX + scaleY) / 2;
  if (!Number.isFinite(scale) || scale <= 0) {
    return null;
  }
  return scale;
}

/**
 * One cell of a subdivided image warp: the axis-aligned source-image rectangle
 * `crop` (in source pixels) and the four destination corners it maps to under
 * the exact projective transform. See {@link subdivideWarpQuads}.
 */
export interface WarpQuad {
  ul: Point;
  ur: Point;
  lr: Point;
  ll: Point;
  crop: { left: number; top: number; right: number; bottom: number };
}

/**
 * Choose a subdivision grid size for rendering the warp of a `width` x `height`
 * image through `h` with an affine-only quad renderer (e.g. geojs' canvas
 * renderer, which draws each quad from only three of its corners). A pure
 * affine matrix (zero perspective row terms) warps exactly as a single
 * parallelogram, so 1 is returned; when the perspective terms are
 * non-negligible over the image extent, `maxN` is returned so each sub-quad is
 * approximately affine.
 */
export function warpGridSize(h: Matrix3, width: number, height: number, maxN = 8): number {
  // Homogeneous w at each image corner: constant w <=> affine transform.
  const wAt = (x: number, y: number) => h[2][0] * x + h[2][1] * y + h[2][2];
  const ws = [wAt(0, 0), wAt(width, 0), wAt(width, height), wAt(0, height)];
  if (ws.some((w) => !Number.isFinite(w) || w === 0)) {
    return maxN;
  }
  const absW = ws.map((w) => Math.abs(w));
  const maxAbs = Math.max(...absW);
  const minAbs = Math.min(...absW);
  // Sign change means the horizon line crosses the image: definitely projective.
  if (ws.some((w) => w * ws[0] < 0)) {
    return maxN;
  }
  // Relative variation of w across the quad; below ~0.1% the affine
  // approximation is visually indistinguishable (sub-pixel for typical sizes).
  return (maxAbs - minAbs) / maxAbs < 1e-3 ? 1 : maxN;
}

/**
 * Subdivide the warp of a `width` x `height` image through `h` into an n x n
 * grid of {@link WarpQuad}s. Every sub-quad corner is mapped through the exact
 * projective transform, so rendering each cell as an (approximately affine)
 * textured quad converges to the true projective warp as n grows -- unlike
 * rendering the whole image as a single quad, which an affine canvas renderer
 * collapses to a parallelogram. Grid lines land on integer source pixels;
 * degenerate (zero-area) cells from tiny images are skipped.
 *
 * `overlap` expands each cell by that many source pixels (clamped to the
 * image). The canvas renderer antialiases every quad's border against the
 * transparent background, so abutting cells meet as two half-transparent
 * edges and show as dark seam lines along the grid; overlapping cells paint
 * over each other's seams with pixel-identical content (corners still map
 * through the same exact homography). Only for opaque drawing -- translucent
 * quads would double-blend in the overlap, so semi-transparent consumers
 * must apply opacity at the layer level and draw quads opaque.
 */
export function subdivideWarpQuads(
  h: Matrix3,
  width: number,
  height: number,
  n: number,
  overlap = 0,
): WarpQuad[] {
  const cells = Math.max(1, Math.floor(n));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= cells; i += 1) {
    xs.push(Math.round((i * width) / cells));
    ys.push(Math.round((i * height) / cells));
  }
  const quads: WarpQuad[] = [];
  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const left = Math.max(0, xs[col] - overlap);
      const right = Math.min(width, xs[col + 1] + overlap);
      const top = Math.max(0, ys[row] - overlap);
      const bottom = Math.min(height, ys[row + 1] + overlap);
      if (right <= left || bottom <= top) {
        // eslint-disable-next-line no-continue
        continue;
      }
      quads.push({
        ul: applyHomography(h, [left, top]),
        ur: applyHomography(h, [right, top]),
        lr: applyHomography(h, [right, bottom]),
        ll: applyHomography(h, [left, bottom]),
        crop: {
          left, top, right, bottom,
        },
      });
    }
  }
  return quads;
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
      throw new Error('Degenerate point configuration; cannot solve linear system');
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
