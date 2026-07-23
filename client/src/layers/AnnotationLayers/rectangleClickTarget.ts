import { pointInPolygon, type Point2D } from '../../utils';

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
  boxArea: number;
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
 * Prefer detections whose own shape contains the point. If none do (click is
 * only in box envelopes), the smallest box wins so nested annotations beat
 * larger envelopes even when both clicks fall outside every polygon.
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
  if (shapeHits.length > 0) {
    return shapeHits.some((c) => c.trackId === candidateTrackId);
  }
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    if (candidates[i].boxArea < best.boxArea) {
      best = candidates[i];
    }
  }
  return candidateTrackId === best.trackId;
}
