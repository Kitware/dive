/**
 * Geometry of the 3D view's reference furniture: the stereo rig's cameras and
 * a floor grid receding along the depth axis. Everything is in the left
 * camera's frame (x right, y down, z forward), like the plotted positions.
 */
import { Bounds3, Vec3 } from './positions';

export interface RigCalibration {
  /** Left-to-right rotation, row-major, and translation: Xr = R * Xl + T. */
  R: readonly number[] | readonly number[][];
  T: readonly number[] | readonly number[][];
  imageWidth?: number;
  imageHeight?: number;
  calibrations?: Record<string, {
    fx?: number; fy?: number; cx?: number; cy?: number;
  } | undefined>;
}

export interface CameraFrustum {
  name: string;
  center: Vec3;
  /** Image corners at the frustum's depth: top-left, top-right, bottom-right, bottom-left. */
  corners: [Vec3, Vec3, Vec3, Vec3];
}

export interface FloorGrid {
  y: number;
  step: number;
  xs: number[];
  /** Heights marked on the vertical axis, from the top of the scene down to the floor. */
  ys: number[];
  zs: number[];
}

// Used when the calibration carries no intrinsics: about a 60 x 45 degree view.
const DEFAULT_HALF_EXTENT = [0.58, 0.41];

/** Calibration files store R flat or as three rows, and T flat or as a column. */
function numbers(values: unknown, length: number): number[] | null {
  const flat = Array.isArray(values) ? (values as unknown[]).flat(Infinity).map(Number) : [];
  return flat.length === length && flat.every(Number.isFinite) ? flat : null;
}

/** Distance between the two camera centers, or 0 without a usable calibration. */
export function rigBaseline(calibration: RigCalibration | null) {
  const T = numbers(calibration?.T, 3);
  return T ? Math.hypot(...T) : 0;
}

function cornerRays(calibration: RigCalibration | null, name: string): [number, number][] {
  const intrinsics = calibration?.calibrations?.[name];
  const width = calibration?.imageWidth;
  const height = calibration?.imageHeight;
  const {
    fx, fy, cx, cy,
  } = intrinsics ?? {};
  if (fx && fy && width && height && cx !== undefined && cy !== undefined) {
    return [[0, 0], [width, 0], [width, height], [0, height]]
      .map(([u, v]) => [(u - cx) / fx, (v - cy) / fy]);
  }
  const [x, y] = DEFAULT_HALF_EXTENT;
  return [[-x, -y], [x, -y], [x, y], [-x, y]];
}

/** The left camera sits at the origin; the right one only shows with a calibration. */
export function rigCameras(calibration: RigCalibration | null, depth: number): CameraFrustum[] {
  const frustum = (name: string, toLeft: (point: Vec3) => Vec3): CameraFrustum => ({
    name,
    center: toLeft([0, 0, 0]),
    corners: cornerRays(calibration, name)
      .map(([x, y]) => toLeft([x * depth, y * depth, depth])) as CameraFrustum['corners'],
  });
  const cameras = [frustum('left', (point) => point)];
  const R = numbers(calibration?.R, 9);
  const T = numbers(calibration?.T, 3);
  if (R && T) {
    // Xl = Rt * (Xr - T)
    cameras.push(frustum('right', (point) => {
      const shifted = point.map((value, axis) => value - T[axis]);
      return [0, 1, 2].map((column) => (
        R[column] * shifted[0] + R[3 + column] * shifted[1] + R[6 + column] * shifted[2]
      )) as Vec3;
    }));
  }
  return cameras;
}

/** A round spacing (1, 2 or 5 times a power of ten) giving about `count` intervals. */
export function niceStep(extent: number, count = 6) {
  if (!(extent > 0)) {
    return 1;
  }
  const raw = extent / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  let factor = 10;
  if (fraction < 1.5) {
    factor = 1;
  } else if (fraction < 3.5) {
    factor = 2;
  } else if (fraction < 7.5) {
    factor = 5;
  }
  return factor * magnitude;
}

function ticks(min: number, max: number, step: number) {
  const first = Math.floor(min / step);
  const last = Math.ceil(max / step);
  return Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step);
}

/**
 * A grid under the data, reaching from the rig to the farthest position.
 * y grows downward, so "under" is the largest y.
 */
export function floorGrid(bounds: Bounds3, include: readonly Vec3[]): FloorGrid {
  const xs = [bounds[0], bounds[1], ...include.map((point) => point[0])];
  const ys = [bounds[2], bounds[3], ...include.map((point) => point[1])];
  const zs = [bounds[4], bounds[5], ...include.map((point) => point[2])];
  const [xMin, xMax, zMin, zMax] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const extent = Math.max(xMax - xMin, zMax - zMin);
  const step = niceStep(extent);
  const y = Math.max(...ys) + 0.02 * extent;
  return {
    step,
    y,
    xs: ticks(xMin, xMax, step),
    ys: ticks(Math.min(...ys), y, step).filter((value) => value <= y),
    zs: ticks(zMin, zMax, step),
  };
}
