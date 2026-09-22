import { contours, polygonHull, polygonContains } from 'd3';
import type { SegmentationPolygon, SegmentationPredictResponse } from 'dive-common/apispec';
import { componentsBounds } from 'dive-common/recipes/segmentationPolygons';

type Point = [number, number];

function nearest(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return [a[0] + t * dx, a[1] + t * dy];
}

/** Remove redundant contour vertices with a sub-pixel error bound. */
function simplify(points: Point[]): Point[] {
  const keep = new Set([0, points.length - 1]);
  const pending = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop()!;
    let farthest = -1; let distance = 0.25;
    for (let i = start + 1; i < end; i += 1) {
      const q = nearest(points[i], points[start], points[end]);
      const d = (q[0] - points[i][0]) ** 2 + (q[1] - points[i][1]) ** 2;
      if (d > distance) { distance = d; farthest = i; }
    }
    if (farthest >= 0) {
      keep.add(farthest);
      pending.push([start, farthest], [farthest, end]);
    }
  }
  const result = [...keep].sort((a, b) => a - b).map((i) => points[i]);
  return result.length >= 4 ? result : points;
}

/** All mask components and holes, in original image coordinates. */
export function maskGeometry(mask: Uint8Array, width: number, height: number): SegmentationPredictResponse {
  if (mask.length !== width * height) throw new Error('Invalid mask dimensions.');
  const geometry = contours().size([width, height]).thresholds([0.5])(mask as unknown as number[])[0];
  const polygons = geometry.coordinates.map((rings) => {
    const scaled = rings.map((ring) => simplify(ring.map(([x, y]): Point => [
      Math.max(0, Math.min(width, x)), Math.max(0, Math.min(height, y)),
    ])));
    return { exterior: scaled[0], holes: scaled.slice(1) };
  });
  if (!polygons.length) return { success: false, error: 'No object found for these prompts.' };
  const rleMask: [number, number][] = [];
  for (let i = 0; i < mask.length; i += 1) {
    const value = mask[i] ? 1 : 0;
    const last = rleMask[rleMask.length - 1];
    if (last?.[0] === value) last[1] += 1;
    else rleMask.push([value, 1]);
  }
  return {
    success: true,
    polygons,
    polygon: polygons[0].exterior,
    bounds: componentsBounds(polygons),
    rleMask,
    maskShape: [height, width],
  };
}

/** VIAME's hull_extremes method: minimum-area hull rectangle, short-edge
 * midpoints, then closest exterior-boundary points. Includes every component. */
export function maskKeypoints(polygons: SegmentationPolygon[]): { success: true; head: Point; tail: Point } {
  const hull = polygonHull(polygons.flatMap((p) => p.exterior));
  if (!hull || hull.length < 3) throw new Error('Mask is too small to derive head/tail.');
  let area = Infinity; let endpoints: Point[] = [];
  hull.forEach((a, i) => {
    const b = hull[(i + 1) % hull.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!length) return;
    const ux = (b[0] - a[0]) / length; const uy = (b[1] - a[1]) / length;
    const xs = hull.map((p) => p[0] * ux + p[1] * uy);
    const ys = hull.map((p) => -p[0] * uy + p[1] * ux);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs);
    const y0 = Math.min(...ys); const y1 = Math.max(...ys);
    const nextArea = (x1 - x0) * (y1 - y0);
    if (nextArea >= area) return;
    area = nextArea;
    const ends = x1 - x0 >= y1 - y0
      ? [[x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]
      : [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]];
    endpoints = ends.map(([x, y]): Point => [x * ux - y * uy, x * uy + y * ux]);
  });
  const clipped = endpoints.map((p) => {
    let best = p; let distance = Infinity;
    polygons.forEach(({ exterior }) => exterior.forEach((a, i) => {
      const q = nearest(p, a, exterior[(i + 1) % exterior.length]);
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      if (d < distance) { best = q; distance = d; }
    }));
    return best;
  }).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  return { success: true, head: clipped[0], tail: clipped[1] };
}

/** Interior seeds for existing masks; polygon centres may fall in holes or
 * outside concave objects. Sample each component independently. */
export function maskSeeds(polygons: SegmentationPolygon[]): Point[] {
  return polygons.flatMap((polygon) => {
    const [x0, y0, x1, y1] = componentsBounds([polygon]);
    const inside = (p: Point) => polygonContains(polygon.exterior, p)
      && !polygon.holes.some((hole) => polygonContains(hole, p));
    const candidates: Point[] = [];
    for (let y = 1; y < 10; y += 1) {
      for (let x = 1; x < 10; x += 1) {
        const p: Point = [x0 + ((x1 - x0) * x) / 10, y0 + ((y1 - y0) * y) / 10];
        if (inside(p)) candidates.push(p);
      }
    }
    // Thin objects may miss the grid: test points just inside their edges.
    if (!candidates.length) {
      polygon.exterior.forEach((a, i) => {
        const b = polygon.exterior[(i + 1) % polygon.exterior.length];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        [-0.25, 0.25].forEach((offset) => {
          const p: Point = [(a[0] + b[0]) / 2 - (offset * (b[1] - a[1])) / d,
            (a[1] + b[1]) / 2 + (offset * (b[0] - a[0])) / d];
          if (inside(p)) candidates.push(p);
        });
      });
    }
    return candidates.filter((_, i) => i % Math.max(1, Math.ceil(candidates.length / 5)) === 0).slice(0, 5);
  });
}
