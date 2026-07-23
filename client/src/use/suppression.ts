/**
 * Suppression regions.
 *
 * A "suppression region" is an annotation whose type matches the configured
 * suppression type (clientSettings.typeSettings.suppressionType). Any detection
 * whose geometry lies at least the configured overlap threshold
 * (clientSettings.typeSettings.suppressionThreshold, default 95%) under one
 * or more suppression regions on a given frame is treated as suppressed: it
 * is hidden from the canvas and excluded from type/track/detection counts.
 *
 * Overlap uses whichever geometry each side actually has: the region's polygon
 * if it has one, else its bounding box; likewise for the detection. The overlap
 * fraction (area of the detection covered by the union of regions, divided by
 * the detection's own area) is estimated by point sampling, which handles the
 * concave, warped field-of-view polygons the sea-lion suppressor emits without
 * a polygon-clipping dependency.
 */
import type { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import type BaseAnnotationStore from 'vue-media-annotator/BaseAnnotationStore';
import type Track from 'vue-media-annotator/track';
import type { Feature } from 'vue-media-annotator/track';

export const DEFAULT_SUPPRESSION_THRESHOLD = 0.95;

/**
 * Normalize the stored suppression-overlap setting (a percent, 0-100) to a
 * fraction, falling back to the default (95%) for missing or out-of-range
 * values.
 */
export function normalizeSuppressionThreshold(percent: number | undefined): number {
  const p = Number(percent);
  if (!Number.isFinite(p) || p <= 0 || p > 100) {
    return DEFAULT_SUPPRESSION_THRESHOLD;
  }
  return p / 100;
}

type Pt = [number, number];
type Rect = [number, number, number, number];
interface Shape { poly?: Pt[]; bbox: Rect }

// Sampling resolution used to estimate the covered-area fraction. 16x16
// keeps the per-frame cost low; at a 95% threshold it resolves the covered
// fraction to ~0.4% granularity on typical detections.
const GRID = 16;

function bboxOfPoly(poly: Pt[]): Rect {
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  poly.forEach(([x, y]) => {
    x1 = Math.min(x1, x); y1 = Math.min(y1, y);
    x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  });
  return [x1, y1, x2, y2];
}

/** Geometry of a detection/region on a frame: its polygon if present, else its box. */
function featureShape(feature: Feature | null): Shape | null {
  if (!feature) return null;
  const polyFeat = feature.geometry?.features?.find(
    (f) => f.geometry?.type === 'Polygon',
  );
  if (polyFeat) {
    const ring = (polyFeat.geometry as GeoJSON.Polygon).coordinates[0];
    if (ring && ring.length >= 3) {
      const poly = ring.map((c) => [c[0], c[1]] as Pt);
      return { poly, bbox: bboxOfPoly(poly) };
    }
  }
  if (feature.bounds) return { bbox: feature.bounds as Rect };
  return null;
}

function pointInPoly(px: number, py: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (((yi > py) !== (yj > py))
      && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInShape(px: number, py: number, shape: Shape): boolean {
  if (shape.poly) return pointInPoly(px, py, shape.poly);
  const [x1, y1, x2, y2] = shape.bbox;
  return px >= x1 && px <= x2 && py >= y1 && py <= y2;
}

/** Fraction of the detection's area covered by the union of the regions. */
function overlapFraction(det: Shape, regions: Shape[]): number {
  const [x1, y1, x2, y2] = det.bbox;
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return 0;
  let inDet = 0;
  let covered = 0;
  for (let iy = 0; iy < GRID; iy += 1) {
    const py = y1 + ((iy + 0.5) / GRID) * h;
    for (let ix = 0; ix < GRID; ix += 1) {
      const px = x1 + ((ix + 0.5) / GRID) * w;
      if (pointInShape(px, py, det)) {
        inDet += 1;
        if (regions.some((r) => pointInShape(px, py, r))) covered += 1;
      }
    }
  }
  return inDet === 0 ? 0 : covered / inDet;
}

/**
 * Loose truthiness for a suppression attribute value set by a user or
 * pipeline: true, a nonzero number, or 'true'/'yes'/'on'/'1' (any case).
 */
export function isSuppressedAttributeValue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['true', 'yes', 'on', '1'].includes(value.trim().toLowerCase());
  }
  return false;
}

/**
 * True when the detection carries the suppression attribute: an attribute
 * named after the suppression type, set on the track or on its detection at
 * `frame` (falling back to the previous keyframe when the frame is
 * interpolated). Unlike region suppression this is display-only: the
 * detection stays visible but is styled, labeled, and counted as the
 * suppression type instead of its own.
 */
export function hasSuppressionAttribute(
  track: Track,
  frame: number,
  suppressionType: string | undefined,
): boolean {
  if (!suppressionType) return false;
  if (isSuppressedAttributeValue(track.attributes?.[suppressionType])) return true;
  const [real, lower] = track.getFeature(frame);
  const feature = real?.attributes ? real : lower;
  return isSuppressedAttributeValue(feature?.attributes?.[suppressionType]);
}

/**
 * Upper bound on the fraction of the detection's bbox covered by the regions,
 * from bbox overlaps alone (sum over regions, so overlapping regions
 * over-count -- fine for an upper bound). Lets candidates that cannot
 * possibly reach the threshold skip the expensive point sampling.
 */
function bboxCoverUpperBound(det: Rect, regions: Shape[]): number {
  const [dx1, dy1, dx2, dy2] = det;
  const detArea = Math.max(0, dx2 - dx1) * Math.max(0, dy2 - dy1);
  if (detArea <= 0) return 0;
  let sum = 0;
  regions.forEach(({ bbox: [rx1, ry1, rx2, ry2] }) => {
    const w = Math.min(dx2, rx2) - Math.max(dx1, rx1);
    const h = Math.min(dy2, ry2) - Math.max(dy1, ry1);
    if (w > 0 && h > 0) sum += w * h;
  });
  return sum / detArea;
}

interface SuppressionCacheEntry {
  revision: number;
  type: string;
  threshold: number;
  byFrame: Map<number, Set<AnnotationId>>;
}
/** Per-store memo of frame results, valid for one edit revision. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const suppressionCache = new WeakMap<any, SuppressionCacheEntry>();

/**
 * Track ids whose detection on `frame` is suppressed by a region on that frame.
 * Empty when suppressionType is falsy (feature disabled) or no regions exist.
 * `thresholdPercent` is the minimum covered fraction as a percent (0-100];
 * missing or out-of-range values fall back to the default (95%).
 * `options.revision` (typically the pending-save counter) memoizes the result
 * per store+frame until the revision changes, so the canvas, type counts, and
 * track list share one computation instead of repeating it.
 */
export function getSuppressedTrackIds(
  trackStore: BaseAnnotationStore<Track>,
  frame: number,
  suppressionType: string | undefined,
  thresholdPercent?: number,
  options: { revision?: number } = {},
): Set<AnnotationId> {
  if (!suppressionType) return new Set<AnnotationId>();
  const threshold = normalizeSuppressionThreshold(thresholdPercent);

  let cacheEntry: SuppressionCacheEntry | undefined;
  const { revision } = options;
  if (revision !== undefined) {
    cacheEntry = suppressionCache.get(trackStore);
    if (!cacheEntry || cacheEntry.revision !== revision
      || cacheEntry.type !== suppressionType
      || cacheEntry.threshold !== threshold) {
      cacheEntry = {
        revision, type: suppressionType, threshold, byFrame: new Map(),
      };
      suppressionCache.set(trackStore, cacheEntry);
    }
    const hit = cacheEntry.byFrame.get(frame);
    if (hit !== undefined) return hit;
  }

  const result = new Set<AnnotationId>();
  const ids = trackStore.intervalTree.search([frame, frame])
    .map((s: string) => parseInt(s, 10));
  if (ids.length === 0) {
    cacheEntry?.byFrame.set(frame, result);
    return result;
  }

  const regions: Shape[] = [];
  const candidates: { id: AnnotationId; shape: Shape }[] = [];
  ids.forEach((id) => {
    const track = trackStore.getPossible(id);
    if (!track) return;
    const shape = featureShape(track.getFeature(frame)[0]);
    if (!shape) return;
    if (track.confidencePairs.some(([t]) => t === suppressionType)) {
      regions.push(shape);
    } else {
      candidates.push({ id, shape });
    }
  });
  if (regions.length > 0) {
    candidates.forEach(({ id, shape }) => {
      if (bboxCoverUpperBound(shape.bbox, regions) < threshold) {
        return;
      }
      if (overlapFraction(shape, regions) >= threshold) {
        result.add(id);
      }
    });
  }
  cacheEntry?.byFrame.set(frame, result);
  return result;
}
