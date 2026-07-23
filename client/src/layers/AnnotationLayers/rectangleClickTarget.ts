import { pointInPolygon } from '../../utils';
import type { Point2D } from '../../utils';

export type { Point2D };
/** One detection polygon in display space (outer ring + holes). */
export interface DisplayPolygon {
  outer: Point2D[];
  holes: Point2D[][];
}

/** Minimal detection info needed to decide click ownership. */
export interface RectClickCandidate {
  trackId: number;
  hasPoly: boolean;
  polygons: DisplayPolygon[];
  /** Display-space rectangle outline (matches the GeoJS rect feature border). */
  boxRing: Point2D[];
  /** Axis-aligned bounds area; tie-break when border distances are equal. */
  boxArea: number;
}

/** Squared distance from point to segment a→b. */
export function distanceToSegmentSquared(point: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = (dx * dx) + (dy * dy);
  if (len2 === 0) {
    const ex = point.x - a.x;
    const ey = point.y - a.y;
    return (ex * ex) + (ey * ey);
  }
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + (t * dx);
  const py = a.y + (t * dy);
  const ex = point.x - px;
  const ey = point.y - py;
  return (ex * ex) + (ey * ey);
}

/** Squared distance from point to the nearest edge of a ring. */
export function distanceToRingSquared(point: Point2D, ring: Point2D[]): number {
  if (ring.length < 2) {
    return Number.POSITIVE_INFINITY;
  }
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    min = Math.min(min, distanceToSegmentSquared(point, ring[j], ring[i]));
  }
  return min;
}

/** Whether the point sits inside the detection's own polygon(s), if any. */
export function pointInsideDetectionShape(
  data: Pick<RectClickCandidate, 'hasPoly' | 'polygons'>,
  point: Point2D,
): boolean {
  if (!data.hasPoly || !data.polygons.length) {
    // No polygon: the box is the detection's shape
    return true;
  }
  return data.polygons.some((poly) => pointInPolygon(point, poly.outer, poly.holes));
}

/**
 * Whether this detection should handle a click among all rectangle hits under
 * the cursor while polygons are displayed.
 *
 * Prefer detections whose own shape contains the point. Among that pool (or
 * all envelope hits if none), the closest rectangle border wins — the same
 * rule GeoJS uses for nested annotations.
 */
export function candidateOwnsClick(
  candidateTrackId: number,
  candidates: RectClickCandidate[],
  point: Point2D,
): boolean {
  if (!candidates.length) {
    return true;
  }
  const shapeHits = candidates.filter((c) => pointInsideDetectionShape(c, point));
  const pool = shapeHits.length > 0 ? shapeHits : candidates;

  let best = pool[0];
  let bestDist = distanceToRingSquared(point, best.boxRing);
  for (let i = 1; i < pool.length; i += 1) {
    const dist = distanceToRingSquared(point, pool[i].boxRing);
    if (
      dist < bestDist
      || (dist === bestDist && pool[i].boxArea < best.boxArea)
    ) {
      best = pool[i];
      bestDist = dist;
    }
  }
  return candidateTrackId === best.trackId;
}
