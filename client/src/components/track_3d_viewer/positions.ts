/**
 * 3D positions of a detection, read from the attributes stereo measurement
 * writes: the head-tail midpoint, and optionally the head and tail themselves.
 */
export type Vec3 = [number, number, number];
export type Bounds3 = [number, number, number, number, number, number];

export interface Position {
  x: number;
  y: number;
  z: number;
  head?: Vec3;
  tail?: Vec3;
}

const AXES = ['x', 'y', 'z'] as const;

function readPoint(attributes: Record<string, unknown>, prefix: string): Vec3 | null {
  const point = AXES.map((axis) => {
    const value = attributes[`${prefix}_${axis}`];
    return value === undefined || value === null || value === '' ? NaN : Number(value);
  });
  return point.every(Number.isFinite) ? point as Vec3 : null;
}

export function featurePosition(attributes?: Record<string, unknown>): Position | null {
  if (!attributes) {
    return null;
  }
  const head = readPoint(attributes, 'head');
  const tail = readPoint(attributes, 'tail');
  const ends = head && tail ? { head, tail } : {};
  const midpoint = readPoint(attributes, 'midpoint')
    ?? (head && tail ? head.map((value, axis) => (value + tail[axis]) / 2) as Vec3 : null);
  if (!midpoint) {
    return null;
  }
  const [x, y, z] = midpoint;
  return {
    x, y, z, ...ends,
  };
}

function quantile(sorted: number[], q: number) {
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * Per-axis range of the points inside Tukey's fences, so a few mismatched
 * detections triangulated far away do not shrink everything else to a dot.
 */
export function robustBounds(points: readonly Vec3[]): Bounds3 | null {
  if (points.length === 0) {
    return null;
  }
  return AXES.flatMap((_, axis) => {
    const values = points.map((point) => point[axis]).sort((a, b) => a - b);
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    const reach = 1.5 * (q3 - q1);
    const inside = values.filter((value) => value >= q1 - reach && value <= q3 + reach);
    return [inside[0], inside[inside.length - 1]];
  }) as Bounds3;
}
