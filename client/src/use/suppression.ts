/**
 * Suppression regions.
 *
 * A "suppression region" is an annotation whose type matches the configured
 * suppression type (clientSettings.typeSettings.suppressionType). Any detection
 * whose geometry lies at least the configured overlap threshold
 * (clientSettings.typeSettings.suppressionThreshold, default 99%) under one
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

export const DEFAULT_SUPPRESSION_THRESHOLD = 0.99;

/**
 * Normalize the stored suppression-overlap setting (a percent, 0-100) to a
 * fraction, falling back to the default (99%) for missing or out-of-range
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
// keeps the per-frame cost low; at a 99% threshold it resolves the covered
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

// Rasterized polygon mask over a region's bbox (scanline even-odd fill, up
// to RASTER_RES cells per axis). The sea-lion suppressor's warped
// field-of-view polygons carry many vertices and every covered candidate
// samples them GRID*GRID times, so each region is rasterized once per frame
// and a sample becomes an O(1) lookup instead of O(vertices).
const RASTER_RES = 256;
interface RegionMask {
  x0: number; y0: number; cw: number; ch: number;
  cols: number; rows: number; data: Uint8Array;
}
interface PreparedRegion { shape: Shape; mask?: RegionMask }

function rasterizePoly(poly: Pt[], bbox: Rect): RegionMask | null {
  const [x1, y1, x2, y2] = bbox;
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return null;
  const cols = Math.max(1, Math.min(RASTER_RES, Math.ceil(w)));
  const rows = Math.max(1, Math.min(RASTER_RES, Math.ceil(h)));
  const cw = w / cols;
  const ch = h / rows;
  const data = new Uint8Array(cols * rows);
  const xs: number[] = [];
  for (let iy = 0; iy < rows; iy += 1) {
    const py = y1 + (iy + 0.5) * ch;
    xs.length = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py)) {
        xs.push(xi + (((py - yi) * (xj - xi)) / (yj - yi)));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - x1) / cw - 0.5));
      const c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - x1) / cw - 0.5));
      for (let c = c0; c <= c1; c += 1) data[(iy * cols) + c] = 1;
    }
  }
  return {
    x0: x1, y0: y1, cw, ch, cols, rows, data,
  };
}

function prepareRegion(shape: Shape): PreparedRegion {
  // Simple polygons are cheap to test directly; masks only pay off (and
  // only introduce their quantization) for vertex-heavy region polygons.
  if (!shape.poly || shape.poly.length <= 8) {
    return { shape };
  }
  return { shape, mask: rasterizePoly(shape.poly, shape.bbox) ?? undefined };
}

function pointInRegion(px: number, py: number, region: PreparedRegion): boolean {
  const { mask } = region;
  if (mask) {
    const c = Math.floor((px - mask.x0) / mask.cw);
    const r = Math.floor((py - mask.y0) / mask.ch);
    if (c < 0 || r < 0 || c >= mask.cols || r >= mask.rows) return false;
    return mask.data[(r * mask.cols) + c] === 1;
  }
  return pointInShape(px, py, region.shape);
}

/** Fraction of the detection's area covered by the union of the regions. */
function overlapFraction(det: Shape, regions: PreparedRegion[]): number {
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
        if (regions.some((r) => pointInRegion(px, py, r))) covered += 1;
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
function bboxCoverUpperBound(det: Rect, regions: PreparedRegion[]): number {
  const [dx1, dy1, dx2, dy2] = det;
  const detArea = Math.max(0, dx2 - dx1) * Math.max(0, dy2 - dy1);
  if (detArea <= 0) return 0;
  let sum = 0;
  regions.forEach(({ shape: { bbox: [rx1, ry1, rx2, ry2] } }) => {
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
 * missing or out-of-range values fall back to the default (99%).
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

  const regions: PreparedRegion[] = [];
  const candidates: { id: AnnotationId; shape: Shape }[] = [];
  ids.forEach((id) => {
    const track = trackStore.getPossible(id);
    if (!track) return;
    const shape = featureShape(track.getFeature(frame)[0]);
    if (!shape) return;
    if (track.confidencePairs.some(([t]) => t === suppressionType)) {
      regions.push(prepareRegion(shape));
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
