/**
 * Stereo rectification, ported from OpenCV's `cvStereoRectify` (Bouguet).
 *
 * The NCC matcher searches the epipolar curve directly and needs none of this.
 * A disparity network does: it consumes a rectified pair, where corresponding
 * points share a row and the correspondence is a pure horizontal shift.
 *
 * Nothing here builds a full-resolution rectified image. `rectifyMapper`
 * returns the inverse map (rectified pixel -> source pixel) so a caller can
 * sample straight into the network's input resolution, fusing rectify+resize
 * into one bilinear read per output pixel.
 */

import { StereoRig } from './calibration';
import { mapPoint, unmap } from './triangulate';

export type Mat3 = Float32Array;
type Vec3 = [number, number, number];

export interface Rectification {
  /** Rectifying rotations for the source and target cameras. */
  R1: Mat3;
  R2: Mat3;
  /** Shared focal length and principal point of the rectified pair. */
  f: number;
  cx: number;
  cy: number;
  /** Rectified image size these were solved for. */
  width: number;
  height: number;
}

function matMul(a: ArrayLike<number>, b: ArrayLike<number>): Mat3 {
  const m = new Float32Array(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return m;
}

function transpose(a: ArrayLike<number>): Mat3 {
  return Float32Array.from([a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]);
}

function matVec(a: ArrayLike<number>, v: ArrayLike<number>): Vec3 {
  return [
    a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
    a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
    a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
  ];
}

/** Rotation matrix -> rotation vector (axis * angle). */
export function rodriguesInv(R: ArrayLike<number>): Vec3 {
  const trace = R[0] + R[4] + R[8];
  const cos = Math.min(1, Math.max(-1, (trace - 1) / 2));
  const angle = Math.acos(cos);
  if (angle < 1e-9) return [0, 0, 0];
  const s = angle / (2 * Math.sin(angle));
  return [s * (R[7] - R[5]), s * (R[2] - R[6]), s * (R[3] - R[1])];
}

/** Rotation vector -> rotation matrix. */
export function rodrigues(v: ArrayLike<number>): Mat3 {
  const theta = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (theta < 1e-9) return Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const [x, y, z] = [v[0] / theta, v[1] / theta, v[2] / theta];
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const t = 1 - c;
  return Float32Array.from([
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]);
}

/**
 * Solve the rectifying rotations for a rig.
 *
 * The focal length is the smaller of the two cameras' so the rectified frustum
 * stays inside both, and the principal point is centred on the output. This is
 * OpenCV's `alpha = 0`-free behaviour: no zoom-to-valid-region crop, which on a
 * rig whose baseline sits far from horizontal demands an extreme zoom and can
 * push the whole scene off canvas.
 */
export function computeRectification(rig: StereoRig, width: number, height: number): Rectification {
  // Half-rotate both cameras toward each other: r = R^(-1/2).
  const om = rodriguesInv(rig.R);
  const r = rodrigues([-om[0] / 2, -om[1] / 2, -om[2] / 2]);
  const t = matVec(r, rig.T);

  // New x axis along the (half-rotated) baseline.
  const nt = Math.hypot(t[0], t[1], t[2]) || 1;
  const horizontal = Math.abs(t[0]) > Math.abs(t[1]);
  const idx = horizontal ? 0 : 1;
  const uu: Vec3 = [0, 0, 0];
  uu[idx] = t[idx] > 0 ? 1 : -1;

  // Rotate about the axis that carries the baseline onto uu.
  const ww: Vec3 = [
    t[1] * uu[2] - t[2] * uu[1],
    t[2] * uu[0] - t[0] * uu[2],
    t[0] * uu[1] - t[1] * uu[0],
  ];
  const nw = Math.hypot(ww[0], ww[1], ww[2]);
  let wR: Mat3;
  if (nw < 1e-12) {
    wR = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  } else {
    const scale = Math.acos(Math.abs(t[idx]) / nt) / nw;
    wR = rodrigues([ww[0] * scale, ww[1] * scale, ww[2] * scale]);
  }

  return {
    R1: matMul(wR, transpose(r)),
    R2: matMul(wR, r),
    f: Math.min(rig.Kl[0], rig.Kr[0]),
    cx: (width - 1) / 2,
    cy: (height - 1) / 2,
    width,
    height,
  };
}

/** Source pixel -> rectified pixel, for the source (R1) or target (R2) camera. */
export function rectifyPoint(px: number, py: number, rig: StereoRig, rect: Rectification, target: boolean): [number, number] {
  const K = target ? rig.Kr : rig.Kl;
  const d = target ? rig.distr : rig.distl;
  const R = target ? rect.R2 : rect.R1;
  const [nx, ny] = unmap(px, py, K, d);
  const p = matVec(R, [nx, ny, 1]);
  if (p[2] === 0) return [NaN, NaN];
  return [rect.f * (p[0] / p[2]) + rect.cx, rect.f * (p[1] / p[2]) + rect.cy];
}

/** Rectified pixel -> source pixel (the inverse of {@link rectifyPoint}). */
export function unrectifyPoint(rx: number, ry: number, rig: StereoRig, rect: Rectification, target: boolean): [number, number] {
  const K = target ? rig.Kr : rig.Kl;
  const d = target ? rig.distr : rig.distl;
  const R = target ? rect.R2 : rect.R1;
  const p = matVec(transpose(R), [(rx - rect.cx) / rect.f, (ry - rect.cy) / rect.f, 1]);
  if (p[2] === 0) return [NaN, NaN];
  return mapPoint(p[0] / p[2], p[1] / p[2], K, d);
}

/**
 * Inverse map for building a rectified image: for each rectified pixel, the
 * source pixel to sample. Returned as flat x/y arrays of length width*height so
 * the caller can bilinear-sample without recomputing the projection per frame.
 */
export function rectifyMapper(rig: StereoRig, rect: Rectification, target: boolean): { mapX: Float32Array; mapY: Float32Array } {
  const { width, height } = rect;
  const mapX = new Float32Array(width * height);
  const mapY = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [sx, sy] = unrectifyPoint(x, y, rig, rect, target);
      mapX[y * width + x] = sx;
      mapY[y * width + x] = sy;
    }
  }
  return { mapX, mapY };
}
