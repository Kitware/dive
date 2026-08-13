/**
 * Client-side two-view triangulation and stereo measurement, mirroring
 * `viame::core::compute_stereo_measurement` (plugins/core/measurement_utilities.cxx)
 * and its host-side NumPy ports (plugins/onnx/triangulate.py, geometry_numpy.py).
 *
 * The world frame is the left camera (R = I, t = 0), so a point's range is just
 * the norm of its coordinates. Distortion uses the vital radial-tangential model
 * [k1, k2, p1, p2, k3, k4, k5, k6].
 *
 * The homogeneous DLT's null vector comes from the adjugate of AᵀA rather than an
 * SVD: for a (near-)rank-3 symmetric matrix every adjugate column is proportional
 * to the smallest eigenvector, which is what the exported ONNX graph relies on.
 */

import { StereoRig } from './calibration';

export interface StereoMeasurement {
  length: number;
  midpoint_x: number;
  midpoint_y: number;
  midpoint_z: number;
  midpoint_range: number;
  stereo_rms: number;
}

type Vec2 = [number, number];
type Vec3 = [number, number, number];

const UNDISTORT_ITERS = 5;

function radialScale(r2: number, d: ArrayLike<number>): number {
  const r4 = r2 * r2;
  const r6 = r2 * r4;
  const num = 1 + r2 * d[0] + r4 * d[1] + r6 * d[4];
  const den = 1 + r2 * d[5] + r4 * d[6] + r6 * d[7];
  return num / den;
}

function radialDeriv(r2: number, d: ArrayLike<number>): number {
  const r4 = r2 * r2;
  const r6 = r4 * r2;
  const base = d[0] + 2 * d[1] * r2 + 3 * d[4] * r4;
  const a1 = 1 / (d[5] * r2 + d[6] * r4 + d[7] * r6 + 1);
  const a2 = d[5] + 2 * d[6] * r2 + 3 * d[7] * r4;
  return (base - a2 * a1 * (d[0] * r2 + d[1] * r4 + d[4] * r6 + 1)) * a1;
}

function distort(x: number, y: number, d: ArrayLike<number>): Vec2 {
  const x2 = x * x;
  const y2 = y * y;
  const r2 = x2 + y2;
  const scale = radialScale(r2, d);
  const twoXy = 2 * x * y;
  return [
    scale * x + d[2] * twoXy + d[3] * (r2 + 2 * x2),
    scale * y + d[2] * (r2 + 2 * y2) + d[3] * twoXy,
  ];
}

/** Newton inverse of {@link distort}; the residual is exact, so it converges to the true point. */
function undistort(dx: number, dy: number, d: ArrayLike<number>): Vec2 {
  let x = dx;
  let y = dy;
  for (let i = 0; i < UNDISTORT_ITERS; i += 1) {
    const x2 = x * x;
    const y2 = y * y;
    const xy = x * y;
    const r2 = x2 + y2;
    const scale = radialScale(r2, d);
    const dScale = 2 * radialDeriv(r2, d);
    const axy = 2 * (d[2] * x + d[3] * y);
    const ay = 2 * d[2] * y;
    const ax = 2 * d[3] * x;
    const j00 = dScale * x2 + scale + (ay + 3 * ax);
    const j01 = dScale * xy + axy;
    const j10 = dScale * xy + axy;
    const j11 = dScale * y2 + scale + (3 * ay + ax);
    const [px, py] = distort(x, y, d);
    const resX = px - dx;
    const resY = py - dy;
    const det = j00 * j11 - j01 * j10;
    if (!det) break;
    const inv = 1 / det;
    x -= inv * (j11 * resX - j01 * resY);
    y -= inv * (-j10 * resX + j00 * resY);
  }
  return [x, y];
}

/** Pixel to normalized, undistorted image coordinates (vital's camera_intrinsics::unmap). */
export function unmap(px: number, py: number, K: ArrayLike<number>, d: ArrayLike<number>): Vec2 {
  const f = K[0];
  const skew = K[1];
  const ppx = K[2];
  const fy = K[4];
  const ppy = K[5];
  const y = (py - ppy) / fy;
  const x = (px - ppx - y * skew) / f;
  return undistort(x, y, d);
}

/** Normalized image coordinates back to a pixel (vital's camera_intrinsics::map). */
export function mapPoint(nx: number, ny: number, K: ArrayLike<number>, d: ArrayLike<number>): Vec2 {
  const f = K[0];
  const skew = K[1];
  const ppx = K[2];
  const fy = K[4];
  const ppy = K[5];
  const [dxn, dyn] = distort(nx, ny, d);
  return [dxn * f + dyn * skew + ppx, dyn * fy + ppy];
}

function applyPose(p: Vec3, R: ArrayLike<number>, t: ArrayLike<number>): Vec3 {
  return [
    R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0],
    R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1],
    R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2],
  ];
}

/** Project a world point into a camera (simple_camera_perspective::project). */
export function project(
  p: Vec3,
  K: ArrayLike<number>,
  d: ArrayLike<number>,
  R: ArrayLike<number>,
  t: ArrayLike<number>,
): Vec2 {
  const pc = applyPose(p, R, t);
  return mapPoint(pc[0] / pc[2], pc[1] / pc[2], K, d);
}

/**
 * Essential matrix for a rig whose left camera is the world origin, returned in
 * the convention the correction below uses: `leftᵀ · E · right == 0`. The rig's
 * relative pose gives `[T]ₓ R`, which satisfies `rightᵀ · ([T]ₓ R) · left == 0`,
 * so this is its transpose.
 */
function essential(R: ArrayLike<number>, T: ArrayLike<number>): number[] {
  const n = Math.hypot(T[0], T[1], T[2]) || 1;
  const [tx, ty, tz] = [T[0] / n, T[1] / n, T[2] / n];
  const skew = [0, -tz, ty, tz, 0, -tx, -ty, tx, 0];
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let s = 0;
      for (let k = 0; k < 3; k += 1) s += skew[i * 3 + k] * R[k * 3 + j];
      out[j * 3 + i] = s;
    }
  }
  return out;
}

/** Lindstrom's one-step optimal correction of a normalized correspondence. */
function optimalImagePoints(E: number[], p1: Vec2, p2: Vec2): [Vec2, Vec2] {
  const p1h: Vec3 = [p1[0], p1[1], 1];
  const p2h: Vec3 = [p2[0], p2[1], 1];
  // l1 = (E · p2h)[:2], l2 = (Eᵀ · p1h)[:2]
  let l1: Vec2 = [
    E[0] * p2h[0] + E[1] * p2h[1] + E[2],
    E[3] * p2h[0] + E[4] * p2h[1] + E[5],
  ];
  let l2: Vec2 = [
    E[0] * p1h[0] + E[3] * p1h[1] + E[6],
    E[1] * p1h[0] + E[4] * p1h[1] + E[7],
  ];
  const eSub = [E[0], E[1], E[3], E[4]];
  const a = l1[0] * (eSub[0] * l2[0] + eSub[1] * l2[1])
    + l1[1] * (eSub[2] * l2[0] + eSub[3] * l2[1]);
  const b = (l1[0] * l1[0] + l1[1] * l1[1] + l2[0] * l2[0] + l2[1] * l2[1]) / 2;
  const c = p1h[0] * (E[0] * p2h[0] + E[1] * p2h[1] + E[2])
    + p1h[1] * (E[3] * p2h[0] + E[4] * p2h[1] + E[5])
    + (E[6] * p2h[0] + E[7] * p2h[1] + E[8]);
  const disc = Math.max(b * b - a * c, 0);
  const d = Math.sqrt(disc);
  let lam = c / (b + d);
  if (!Number.isFinite(lam)) return [p1, p2];
  // l1 -= eSub · (lam·l1); l2 -= eSubᵀ · (lam·l2)
  const s1: Vec2 = [lam * l1[0], lam * l1[1]];
  const s2: Vec2 = [lam * l2[0], lam * l2[1]];
  l1 = [l1[0] - (eSub[0] * s1[0] + eSub[1] * s1[1]), l1[1] - (eSub[2] * s1[0] + eSub[3] * s1[1])];
  l2 = [l2[0] - (eSub[0] * s2[0] + eSub[2] * s2[1]), l2[1] - (eSub[1] * s2[0] + eSub[3] * s2[1])];
  const denom = l1[0] * l1[0] + l1[1] * l1[1] + l2[0] * l2[0] + l2[1] * l2[1];
  if (!denom) return [p1, p2];
  lam *= (2 * d) / denom;
  if (!Number.isFinite(lam)) return [p1, p2];
  return [
    [p1h[0] - lam * l1[0], p1h[1] - lam * l1[1]],
    [p2h[0] - lam * l2[0], p2h[1] - lam * l2[1]],
  ];
}

function det3(m: number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** Smallest eigenvector of a symmetric 4x4, hnormalized, via its adjugate. */
function nullVector4x4(M: number[]): Vec3 | null {
  const cof: number[] = new Array(16).fill(0);
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      const minor: number[] = [];
      for (let r = 0; r < 4; r += 1) {
        if (r !== i) {
          for (let c = 0; c < 4; c += 1) {
            if (c !== j) minor.push(M[r * 4 + c]);
          }
        }
      }
      cof[i * 4 + j] = ((i + j) % 2 ? -1 : 1) * det3(minor);
    }
  }
  let best = 0;
  let bestNorm = -1;
  for (let j = 0; j < 4; j += 1) {
    let n = 0;
    for (let i = 0; i < 4; i += 1) n += cof[i * 4 + j] ** 2;
    if (n > bestNorm) {
      bestNorm = n;
      best = j;
    }
  }
  const w = cof[3 * 4 + best];
  if (!w || !Number.isFinite(w)) return null;
  const v: Vec3 = [cof[best] / w, cof[4 + best] / w, cof[8 + best] / w];
  return v.every((n) => Number.isFinite(n)) ? v : null;
}

/**
 * Triangulate one correspondence into the world (= left camera) frame.
 * `leftPx` / `rightPx` are pixel coordinates in their respective cameras.
 */
export function triangulatePoint(rig: StereoRig, leftPx: Vec2, rightPx: Vec2): Vec3 | null {
  const nl = unmap(leftPx[0], leftPx[1], rig.Kl, rig.distl);
  const nr = unmap(rightPx[0], rightPx[1], rig.Kr, rig.distr);
  const E = essential(rig.R, rig.T);
  const [cp0, cp1] = optimalImagePoints(E, nl, nr);

  // pose0 = [I | 0], pose1 = [R | T]
  const pose0 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const pose1 = [
    rig.R[0], rig.R[1], rig.R[2], rig.T[0],
    rig.R[3], rig.R[4], rig.R[5], rig.T[1],
    rig.R[6], rig.R[7], rig.R[8], rig.T[2],
  ];
  const row = (pt: Vec2, pose: number[], axis: 0 | 1) => [0, 1, 2, 3].map(
    (k) => pt[axis] * pose[8 + k] - pose[axis * 4 + k],
  );
  const A = [
    row(cp0, pose0, 0), row(cp0, pose0, 1),
    row(cp1, pose1, 0), row(cp1, pose1, 1),
  ];

  const M: number[] = new Array(16).fill(0);
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += A[k][i] * A[k][j];
      M[i * 4 + j] = s;
    }
  }
  return nullVector4x4(M);
}

const IDENTITY_3X3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO_3 = [0, 0, 0];

/**
 * Full stereo measurement for a head/tail line seen in both cameras: length,
 * 3D midpoint, range from the left camera, and RMS reprojection error over the
 * four image measurements. Returns null if either endpoint fails to triangulate.
 */
export function measureLine(
  rig: StereoRig,
  leftLine: [Vec2, Vec2],
  rightLine: [Vec2, Vec2],
): StereoMeasurement | null {
  const head = triangulatePoint(rig, leftLine[0], rightLine[0]);
  const tail = triangulatePoint(rig, leftLine[1], rightLine[1]);
  if (!head || !tail) return null;

  const length = Math.hypot(tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]);
  const mid: Vec3 = [
    (head[0] + tail[0]) / 2, (head[1] + tail[1]) / 2, (head[2] + tail[2]) / 2,
  ];

  const errSq = (p: Vec3, lp: Vec2, rp: Vec2) => {
    const lr = project(p, rig.Kl, rig.distl, IDENTITY_3X3, ZERO_3);
    const rr = project(p, rig.Kr, rig.distr, rig.R, rig.T);
    return (lr[0] - lp[0]) ** 2 + (lr[1] - lp[1]) ** 2
      + (rr[0] - rp[0]) ** 2 + (rr[1] - rp[1]) ** 2;
  };
  const rms = Math.sqrt(
    (errSq(head, leftLine[0], rightLine[0]) + errSq(tail, leftLine[1], rightLine[1])) / 4,
  );

  const measurement: StereoMeasurement = {
    length,
    midpoint_x: mid[0],
    midpoint_y: mid[1],
    midpoint_z: mid[2],
    midpoint_range: Math.hypot(mid[0], mid[1], mid[2]),
    stereo_rms: rms,
  };
  return Object.values(measurement).every((v) => Number.isFinite(v)) ? measurement : null;
}

/**
 * Mean of the positive lengths along a track, matching the "average" default of
 * `viame::core::aggregate_lengths`. Returns null when nothing is measurable.
 */
export function aggregateLengths(lengths: number[]): number | null {
  const valid = lengths.filter((v) => Number.isFinite(v) && v > 0);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
