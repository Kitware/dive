import type { RectBounds } from 'vue-media-annotator/utils';

export type Point = [number, number];

export type NewAnnotationGeometry =
  | { source: 'box'; bounds: RectBounds }
  | { source: 'line'; line: Point[] };

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
