/**
 * Client-side stereo calibration loading, mirroring VIAME's `read_stereo_rig`
 * (`plugins/core/camera_rig_io.cxx`) and the Python `calibration_io.py`.
 *
 * The world frame is the left camera: the left camera is at (R = I, t = 0) and
 * the right camera carries the rig's relative rotation R and translation T.
 * Distortion uses the OpenCV/vital radial-tangential model
 * [k1, k2, p1, p2, k3, k4, k5, k6], zero-padded to 8.
 */

import { parseNpz, NpyArray } from './npz';

export interface StereoRig {
  /** 3x3 left intrinsics, row-major. */
  Kl: Float32Array;
  /** 8 distortion coefficients for the left camera. */
  distl: Float32Array;
  Kr: Float32Array;
  distr: Float32Array;
  /** 3x3 rotation of the right camera (world = left camera), row-major. */
  R: Float32Array;
  /** 3-vector translation of the right camera. */
  T: Float32Array;
}

function pad8(arr: ArrayLike<number> | undefined): Float32Array {
  const out = new Float32Array(8);
  if (arr) {
    const n = Math.min(8, arr.length);
    for (let i = 0; i < n; i += 1) out[i] = arr[i];
  }
  return out;
}

function as3x3(arr: ArrayLike<number>): Float32Array {
  if (arr.length < 9) throw new Error('Expected a 3x3 matrix (9 values)');
  return Float32Array.from(Array.from({ length: 9 }, (_, i) => arr[i]));
}

function pick(arrays: Record<string, NpyArray>, ...names: string[]): NpyArray | undefined {
  return names.map((n) => arrays[n]).find((a) => a !== undefined);
}

/** Build a {@link StereoRig} from a parsed `.npz` array map. */
export function rigFromNpzArrays(arrays: Record<string, NpyArray>): StereoRig {
  const K1 = pick(arrays, 'cameraMatrixL', 'cameraMatrix1', 'M1');
  const K2 = pick(arrays, 'cameraMatrixR', 'cameraMatrix2', 'M2');
  const R = pick(arrays, 'R');
  const T = pick(arrays, 'T');
  if (!K1 || !K2 || !R || !T) {
    throw new Error('NPZ missing required arrays (R, T, cameraMatrixL, cameraMatrixR)');
  }
  const d1 = pick(arrays, 'distCoeffsL', 'distCoeffs1', 'D1');
  const d2 = pick(arrays, 'distCoeffsR', 'distCoeffs2', 'D2');
  return {
    Kl: as3x3(K1.data),
    distl: pad8(d1?.data),
    Kr: as3x3(K2.data),
    distr: pad8(d2?.data),
    R: as3x3(R.data),
    T: Float32Array.from([T.data[0], T.data[1], T.data[2]]),
  };
}

/** Parse a `.npz` calibration archive into a {@link StereoRig}. */
export async function rigFromNpz(buffer: ArrayBuffer | Uint8Array): Promise<StereoRig> {
  return rigFromNpzArrays(await parseNpz(buffer));
}

/**
 * Build a {@link StereoRig} from a JSON calibration object, accepting either the
 * VIAME `fx_left/cx_left/k1_left/.../R/T` schema or an explicit
 * `{ cameraMatrixL, distCoeffsL, cameraMatrixR, distCoeffsR, R, T }` object.
 */
export function rigFromJson(obj: Record<string, unknown>): StereoRig {
  const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
  const flat = (v: unknown): number[] => (Array.isArray(v) ? (v.flat(Infinity) as number[]).map(num) : []);

  if ('fx_left' in obj) {
    const kFor = (side: string) => Float32Array.from([
      num(obj[`fx_${side}`]), 0, num(obj[`cx_${side}`]),
      0, num(obj[`fy_${side}`]), num(obj[`cy_${side}`]),
      0, 0, 1,
    ]);
    const distFor = (side: string) => pad8(
      ['k1', 'k2', 'p1', 'p2', 'k3']
        .filter((k) => `${k}_${side}` in obj)
        .map((k) => num(obj[`${k}_${side}`])),
    );
    return {
      Kl: kFor('left'),
      distl: distFor('left'),
      Kr: kFor('right'),
      distr: distFor('right'),
      R: as3x3(flat(obj.R)),
      T: Float32Array.from(flat(obj.T)),
    };
  }

  const K1 = flat(obj.cameraMatrixL ?? obj.M1);
  const K2 = flat(obj.cameraMatrixR ?? obj.M2);
  if (!K1.length || !K2.length) {
    throw new Error('JSON calibration missing camera matrices');
  }
  return {
    Kl: as3x3(K1),
    distl: pad8(flat(obj.distCoeffsL ?? obj.D1)),
    Kr: as3x3(K2),
    distr: pad8(flat(obj.distCoeffsR ?? obj.D2)),
    R: as3x3(flat(obj.R)),
    T: Float32Array.from(flat(obj.T)),
  };
}

/** Stereo baseline (||T||) — the distance between the two camera centers. */
export function baseline(rig: StereoRig): number {
  const [x, y, z] = rig.T;
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Swap which physical camera is treated as "left" (the source). The matcher
 * always warps the source camera (rig left) to the target (rig right); when the
 * user annotates on the rig's right camera, invert the rig so the annotated
 * camera becomes the source.
 *
 * New world frame = old right camera, so the new right camera (old left) has
 * R' = Rᵀ and T' = -Rᵀ·T; intrinsics/distortion swap sides.
 */
export function invertRig(rig: StereoRig): StereoRig {
  const { R } = rig;
  // R' = Rᵀ
  const Rt = Float32Array.from([
    R[0], R[3], R[6],
    R[1], R[4], R[7],
    R[2], R[5], R[8],
  ]);
  const [tx, ty, tz] = rig.T;
  // T' = -Rᵀ·T
  const Tp = Float32Array.from([
    -(Rt[0] * tx + Rt[1] * ty + Rt[2] * tz),
    -(Rt[3] * tx + Rt[4] * ty + Rt[5] * tz),
    -(Rt[6] * tx + Rt[7] * ty + Rt[8] * tz),
  ]);
  return {
    Kl: rig.Kr,
    distl: rig.distr,
    Kr: rig.Kl,
    distr: rig.distl,
    R: Rt,
    T: Tp,
  };
}
