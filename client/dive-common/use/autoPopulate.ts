import type Track from 'vue-media-annotator/track';
import { pointInPolygon, RectBounds } from 'vue-media-annotator/utils';
import type { SegmentationPolygon } from 'dive-common/apispec';

export type Point = [number, number];

export type NewAnnotationGeometry =
  | { source: 'box'; bounds: RectBounds }
  | { source: 'line'; line: Point[] }
  /** Foreground prompts already known, e.g. points warped from the other stereo camera's mask. */
  | { source: 'points'; points: Point[] }
  /** A mask that already exists on the detection (point segmentation); nothing to predict. */
  | { source: 'mask'; polygons: SegmentationPolygon[] };

/** Fractions of the way along a line at which foreground prompts are placed. */
export const LINE_PROMPT_FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

/**
 * Foreground prompt points for segmenting a freshly drawn shape: the centre
 * of a box, or several points spread along a line (its ends often sit on the
 * background). Always positive labels.
 */
export function autoPopulatePrompt(geometry: NewAnnotationGeometry): { points: Point[]; labels: number[] } {
  if (geometry.source === 'box') {
    const [x0, y0, x1, y1] = geometry.bounds;
    return { points: [[(x0 + x1) / 2, (y0 + y1) / 2]], labels: [1] };
  }
  if (geometry.source === 'mask') return { points: [], labels: [] };
  if (geometry.source === 'points') {
    return { points: geometry.points.map((p) => [...p] as Point), labels: geometry.points.map(() => 1) };
  }
  const { line } = geometry;
  if (line.length < 2) return { points: line.map((p) => [...p] as Point), labels: line.map(() => 1) };
  const total = line.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);
  const points = LINE_PROMPT_FRACTIONS.map((fraction) => {
    let remaining = fraction * total;
    for (let i = 1; i < line.length; i += 1) {
      const segment = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      if (remaining <= segment || i === line.length - 1) {
        const t = segment > 0 ? remaining / segment : 0;
        return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])] as Point;
      }
      remaining -= segment;
    }
    return [...line[line.length - 1]] as Point;
  });
  return { points, labels: points.map(() => 1) };
}

/** Closed ring for a predicted polygon (the service returns an open one). */
export function closedRing(polygon: Point[]): Point[] {
  const ring = polygon.map((p) => [...p] as Point);
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first] as Point);
  return ring;
}

export function polygonBounds(polygon: Point[]): RectBounds {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Below this overlap a stereo-mapped box is taken to have landed badly and is
 * refit to the mask segmented on its own camera.
 */
export const MAPPED_BOX_MIN_IOU = 0.5;

export function boundsIoU(a: RectBounds, b: RectBounds): number {
  const area = ([x0, y0, x1, y1]: RectBounds) => Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const intersection = area([
    Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3]),
  ]);
  const union = area(a) + area(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Grid resolution across a mask's bounds when sampling prompt points inside it. */
const INTERIOR_GRID = 9;

/**
 * Up to `count` points inside a mask, spread across it: the one nearest its
 * centre first, then repeatedly the candidate farthest from those chosen.
 * Points inside the object warp to the other camera far more reliably than a
 * box's corners, which sit on the background.
 */
export function interiorPromptPoints(polygons: SegmentationPolygon[], count = 5): Point[] {
  const xy = ([x, y]: Point) => ({ x, y });
  const valid = polygons.filter((polygon) => polygon.exterior.length >= 3);
  if (!valid.length) return [];
  const [x0, y0, x1, y1] = polygonBounds(valid.flatMap((polygon) => polygon.exterior));
  const inside: Point[] = [];
  for (let i = 0; i < INTERIOR_GRID; i += 1) {
    for (let j = 0; j < INTERIOR_GRID; j += 1) {
      const point: Point = [
        x0 + ((i + 0.5) / INTERIOR_GRID) * (x1 - x0),
        y0 + ((j + 0.5) / INTERIOR_GRID) * (y1 - y0),
      ];
      if (valid.some((polygon) => pointInPolygon(xy(point), polygon.exterior.map(xy), polygon.holes.map((h) => h.map(xy))))) {
        inside.push(point);
      }
    }
  }
  if (!inside.length) return [];
  const centre: Point = [(x0 + x1) / 2, (y0 + y1) / 2];
  const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const chosen = [inside.reduce((best, p) => (distance(p, centre) < distance(best, centre) ? p : best))];
  while (chosen.length < count && chosen.length < inside.length) {
    const next = inside
      .filter((p) => !chosen.includes(p))
      .reduce((best, p) => {
        const gap = (q: Point) => Math.min(...chosen.map((c) => distance(q, c)));
        return gap(p) > gap(best) ? p : best;
      });
    chosen.push(next);
  }
  return chosen;
}

/**
 * Head/tail derived independently on each stereo camera can come out flipped;
 * order this pair to run the same way as the other camera's line.
 */
export function orientLineLike(line: [Point, Point], reference: Point[]): [Point, Point] {
  if (reference.length < 2) return line;
  const [head, tail] = line;
  const refHead = reference[0];
  const refTail = reference[reference.length - 1];
  const dot = (tail[0] - head[0]) * (refTail[0] - refHead[0]) + (tail[1] - head[1]) * (refTail[1] - refHead[1]);
  return dot < 0 ? [tail, head] : line;
}

/** Capture the geometry we prompted; never write results over a later edit. */
export function autoPopulateTarget(getTrack: () => Track | undefined, frame: number) {
  const track = getTrack();
  const snapshot = () => {
    const feature = track?.getFeature(frame)[0];
    return feature ? JSON.stringify([feature.bounds, feature.geometry, feature.head, feature.tail]) : null;
  };
  const initial = snapshot();
  return () => {
    if (!track || initial === null || getTrack() !== track || snapshot() !== initial) return null;
    const feature = track.getFeature(frame)[0];
    return feature ? { track, feature } : null;
  };
}
