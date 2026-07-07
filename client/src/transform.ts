/**
 * Alignment transform models for camera calibration, layered on top of the matrix
 * primitives in {@link "./homography"} (`Matrix3`, `applyHomography`, `invert3`,
 * `solveLinearSystem`). Mirrors keypointgui's `fit_homography` transform types
 * (translation / rigid / similarity / affine / homography) so near-rigid EO/IR
 * rigs can be fit with fewer, more stable point pairs than a full homography
 * requires. Every estimator returns a plain `Matrix3`, so callers (warping,
 * inverse-mapping) never need to special-case the transform type.
 */

import {
  Point, Matrix3, solveLinearSystem, solveHomography,
} from './homography';

export type TransformType = 'translation' | 'rigid' | 'similarity' | 'affine' | 'homography';

/** UI-friendly ordered list of transform types, for dropdowns. */
export const TRANSFORM_TYPES: { value: TransformType; text: string }[] = [
  { value: 'translation', text: 'Translation' },
  { value: 'rigid', text: 'Rigid' },
  { value: 'similarity', text: 'Similarity' },
  { value: 'affine', text: 'Affine' },
  { value: 'homography', text: 'Homography' },
];

const MIN_POINTS: Record<TransformType, number> = {
  translation: 1,
  rigid: 2,
  similarity: 2,
  affine: 3,
  homography: 4,
};

/** Minimum correspondence count to fit `type`, matching keypointgui's fit_homography. */
export function minPointsForTransform(type: TransformType): number {
  return MIN_POINTS[type];
}

/** Pure translation: H = identity with translation = mean(dst - src). Exact for 1+ points. */
export function estimateTranslation(src: Point[], dst: Point[]): Matrix3 {
  const n = src.length;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    dx += dst[i][0] - src[i][0];
    dy += dst[i][1] - src[i][1];
  }
  dx /= n;
  dy /= n;
  return [[1, 0, dx], [0, 1, dy], [0, 0, 1]];
}

/**
 * Closed-form 2D Procrustes/Umeyama fit: rotation (plus optional uniform scale)
 * and translation minimizing sum |R*src + t - dst|^2. SVD-free because a 2D
 * rotation is a single angle: `theta = atan2(B, A)` is the angle that maximizes
 * the projected alignment sum, and (for similarity) the optimal uniform scale is
 * the ratio of that alignment's magnitude to the source points' spread.
 */
function estimateRotationScaleTranslation(
  src: Point[],
  dst: Point[],
  allowScale: boolean,
): Matrix3 {
  const n = src.length;
  let csx = 0;
  let csy = 0;
  let cdx = 0;
  let cdy = 0;
  for (let i = 0; i < n; i += 1) {
    csx += src[i][0];
    csy += src[i][1];
    cdx += dst[i][0];
    cdy += dst[i][1];
  }
  csx /= n;
  csy /= n;
  cdx /= n;
  cdy /= n;

  let a = 0;
  let b = 0;
  let srcVar = 0;
  for (let i = 0; i < n; i += 1) {
    const sx = src[i][0] - csx;
    const sy = src[i][1] - csy;
    const dx = dst[i][0] - cdx;
    const dy = dst[i][1] - cdy;
    a += sx * dx + sy * dy;
    b += sx * dy - sy * dx;
    srcVar += sx * sx + sy * sy;
  }

  const theta = Math.atan2(b, a);
  const scale = allowScale && srcVar > 1e-12 ? Math.hypot(a, b) / srcVar : 1;
  const r00 = Math.cos(theta) * scale;
  const r01 = -Math.sin(theta) * scale;
  const r10 = Math.sin(theta) * scale;
  const r11 = Math.cos(theta) * scale;
  const tx = cdx - (r00 * csx + r01 * csy);
  const ty = cdy - (r10 * csx + r11 * csy);
  return [[r00, r01, tx], [r10, r11, ty], [0, 0, 1]];
}

/** Rotation + translation only (no scale, no shear). Matches keypointgui's rigid fit. */
export function estimateRigid(src: Point[], dst: Point[]): Matrix3 {
  return estimateRotationScaleTranslation(src, dst, false);
}

/** Rotation + uniform scale + translation. Matches keypointgui's similarity fit. */
export function estimateSimilarity(src: Point[], dst: Point[]): Matrix3 {
  return estimateRotationScaleTranslation(src, dst, true);
}

/**
 * Full 6-DOF affine fit via two independent 3-unknown least-squares solves (one
 * output row at a time): dst_x = a*src_x + b*src_y + tx, dst_y = c*src_x + d*src_y
 * + ty. Exact for 3 non-collinear points, least-squares for more.
 */
export function estimateAffine(src: Point[], dst: Point[]): Matrix3 {
  const n = src.length;
  const ata: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atbX: number[] = [0, 0, 0];
  const atbY: number[] = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const row = [src[i][0], src[i][1], 1];
    const dx = dst[i][0];
    const dy = dst[i][1];
    for (let r = 0; r < 3; r += 1) {
      atbX[r] += row[r] * dx;
      atbY[r] += row[r] * dy;
      for (let c = 0; c < 3; c += 1) {
        ata[r][c] += row[r] * row[c];
      }
    }
  }
  // solveLinearSystem mutates its arguments in place, so each solve gets its own copy.
  const rowX = solveLinearSystem(ata.map((row) => [...row]), [...atbX]);
  const rowY = solveLinearSystem(ata.map((row) => [...row]), [...atbY]);
  return [
    [rowX[0], rowX[1], rowX[2]],
    [rowY[0], rowY[1], rowY[2]],
    [0, 0, 1],
  ];
}

/** Estimate a `Matrix3` mapping src -> dst using `type`, enforcing its minimum point count. */
export function estimateTransform(type: TransformType, src: Point[], dst: Point[]): Matrix3 {
  if (src.length !== dst.length) {
    throw new Error('src and dst must have the same number of points');
  }
  const required = minPointsForTransform(type);
  if (src.length < required) {
    throw new Error(`At least ${required} point pair(s) are required for a ${type} transform`);
  }
  switch (type) {
    case 'translation':
      return estimateTranslation(src, dst);
    case 'rigid':
      return estimateRigid(src, dst);
    case 'similarity':
      return estimateSimilarity(src, dst);
    case 'affine':
      return estimateAffine(src, dst);
    case 'homography':
      return solveHomography(src, dst);
    default:
      throw new Error(`Unknown transform type: ${type}`);
  }
}
