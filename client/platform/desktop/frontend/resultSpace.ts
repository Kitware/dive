/**
 * Geometry behind the 3D view of search results: the query sits at the
 * origin, results float around it at their descriptor-space offsets, and an
 * orbiting perspective camera projects them onto the canvas.
 */

export type Vec3 = [number, number, number];

export interface SpacePoint {
  key: string;
  position: Vec3;
}

/**
 * Camera orbit: yaw about the vertical axis, pitch above the horizon, zoom
 * factor, and how far the query has been slid from the viewport's center.
 */
export interface Orbit {
  yaw: number;
  pitch: number;
  zoom: number;
  /** Canvas pixels. */
  panX?: number;
  panY?: number;
}

/** A rectangle on the canvas, by two opposite corners in any order. */
export interface CanvasBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A billboard's half width and half height, as fractions of the square half size. */
export type Shape = (key: string) => [number, number];
const SQUARE: Shape = () => [1, 1];

export interface Viewport {
  width: number;
  height: number;
}

/** A point on the canvas, with its depth from the camera and billboard scale. */
export interface Projected {
  key: string;
  x: number;
  y: number;
  /** Distance from the camera along its view axis; larger is farther away. */
  depth: number;
  /** Size multiplier relative to a billboard at the origin. */
  scale: number;
}

export const DEFAULT_ORBIT: Orbit = {
  yaw: 0.6, pitch: 0.35, zoom: 1, panX: 0, panY: 0,
};

/** Camera distance from the origin at zoom 1; points are normalized inside radius 1. */
const CAMERA_DISTANCE = 3.2;
const MAX_PITCH = Math.PI / 2 - 0.05;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const DRAG_RADIANS_PER_PX = 0.008;
/** Fraction of the shorter viewport side the unit sphere spans at zoom 1. */
const FIT_FRACTION = 0.38;

/** Scale positions uniformly so the farthest point sits at radius 1. */
export function normalizePositions(points: SpacePoint[]): SpacePoint[] {
  const radius = Math.max(...points.map((p) => Math.hypot(...p.position)), 0);
  if (!(radius > 0)) return points.map((p) => ({ key: p.key, position: [0, 0, 0] }));
  return points.map((p) => ({
    key: p.key,
    position: p.position.map((v) => v / radius) as Vec3,
  }));
}

/** Rotate a point into camera-aligned coordinates (camera looks down -z). */
export function rotate([x, y, z]: Vec3, orbit: Orbit): Vec3 {
  const cy = Math.cos(orbit.yaw);
  const sy = Math.sin(orbit.yaw);
  const x1 = cy * x + sy * z;
  const z1 = -sy * x + cy * z;
  const cp = Math.cos(orbit.pitch);
  const sp = Math.sin(orbit.pitch);
  const y2 = cp * y - sp * z1;
  const z2 = sp * y + cp * z1;
  return [x1, y2, z2];
}

export function cameraDistance(orbit: Orbit): number {
  return CAMERA_DISTANCE / orbit.zoom;
}

/**
 * Perspective projection of every point; the origin projects to the
 * viewport center, moved by the orbit's pan.
 */
export function project(points: SpacePoint[], orbit: Orbit, viewport: Viewport): Projected[] {
  const distance = cameraDistance(orbit);
  const focal = FIT_FRACTION * Math.min(viewport.width, viewport.height) * CAMERA_DISTANCE;
  const cx = viewport.width / 2 + (orbit.panX ?? 0);
  const cy = viewport.height / 2 + (orbit.panY ?? 0);
  return points.map((point) => {
    const [x, y, z] = rotate(point.position, orbit);
    const depth = distance - z;
    const s = focal / depth;
    return {
      key: point.key,
      x: cx + x * s,
      y: cy - y * s,
      depth,
      scale: distance / depth,
    };
  });
}

/** Far to near, so nearer billboards paint over farther ones. */
export function paintOrder(projected: Projected[]): Projected[] {
  return [...projected].sort((a, b) => b.depth - a.depth);
}

/**
 * The nearest billboard under a canvas position, given the billboards' half
 * size at scale 1. They are centered on their point, square unless `shape`
 * says otherwise.
 */
export function pick(
  projected: Projected[],
  x: number,
  y: number,
  halfSize: number,
  shape: Shape = SQUARE,
): Projected | null {
  let best: Projected | null = null;
  projected.forEach((p) => {
    const [wide, tall] = shape(p.key);
    const half = halfSize * p.scale;
    if (Math.abs(p.x - x) > half * wide || Math.abs(p.y - y) > half * tall) return;
    if (!best || p.depth < best.depth) best = p;
  });
  return best;
}

/** Every billboard a box drawn on the canvas touches. */
export function pickInBox(
  projected: Projected[],
  box: CanvasBox,
  halfSize: number,
  shape: Shape = SQUARE,
): string[] {
  const [left, right] = [Math.min(box.x1, box.x2), Math.max(box.x1, box.x2)];
  const [top, bottom] = [Math.min(box.y1, box.y2), Math.max(box.y1, box.y2)];
  return projected.filter((p) => {
    const [wide, tall] = shape(p.key);
    const half = halfSize * p.scale;
    return p.x + half * wide >= left && p.x - half * wide <= right
      && p.y + half * tall >= top && p.y - half * tall <= bottom;
  }).map((p) => p.key);
}

/** Billboards shrink as more results are shown, so a thousand still read as separate. */
export function billboardHalfSize(count: number, halfSize: number, smallest: number): number {
  const crowding = count > 100 ? Math.sqrt(100 / count) : 1;
  return Math.max(smallest, Math.round(halfSize * crowding));
}

export function orbitDrag(orbit: Orbit, dx: number, dy: number): Orbit {
  return {
    ...orbit,
    yaw: orbit.yaw + dx * DRAG_RADIANS_PER_PX,
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, orbit.pitch + dy * DRAG_RADIANS_PER_PX)),
  };
}

/** Slide the whole view across the canvas. */
export function orbitPan(orbit: Orbit, dx: number, dy: number): Orbit {
  return { ...orbit, panX: (orbit.panX ?? 0) + dx, panY: (orbit.panY ?? 0) + dy };
}

/** Wheel zoom: each 100 units of deltaY scales by ~1.25x. */
export function orbitZoom(orbit: Orbit, deltaY: number): Orbit {
  const zoom = orbit.zoom * (1.25 ** (-deltaY / 100));
  return { ...orbit, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) };
}
