import { contours, polygonHull, polygonArea } from 'd3';
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

/** Rasterize rounded polygon rings, including their boundary pixels, as in
 * desktop's fillPoly. Work only in the component bounds, not the full frame. */
function rasterRing(
  mask: Uint8Array,
  width: number,
  height: number,
  ring: Point[],
  value: number,
  origin: Point,
) {
  if (ring.length < 3) return;
  // numpy.rint uses ties-to-even when desktop translates vertices into its ROI.
  const round = (v: number) => (v % 1 === 0.5 ? 2 * Math.round(v / 2) : Math.round(v));
  const vertices = ring.map(([x, y]) => [round(x - origin[0]), round(y - origin[1])] as Point);
  const pixels = mask;
  const put = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < width && y < height) pixels[y * width + x] = value; };
  for (let y = 0; y < height; y += 1) {
    const crossings: number[] = [];
    vertices.forEach(([x0, y0], i) => {
      const [x1, y1] = vertices[(i + 1) % vertices.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) crossings.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
    });
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      for (let x = Math.ceil(crossings[i]); x <= Math.floor(crossings[i + 1]); x += 1) put(x, y);
    }
  }
  vertices.forEach(([ax, ay], i) => {
    const [bx, by] = vertices[(i + 1) % vertices.length];
    let x = ax; let y = ay;
    const dx = Math.abs(bx - ax); const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1; const sy = ay < by ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      put(x, y);
      if (x === bx && y === by) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x += sx; }
      if (twice <= dx) { error += dx; y += sy; }
    }
  });
}

/** Desktop mask sampling: deepest point first, then farthest-point sampling
 * among pixels at least one third of the maximum interior depth. */
export function maskSeeds(polygons: SegmentationPolygon[], count = Math.max(2, Math.ceil(5 / polygons.length))): Point[] {
  return polygons.flatMap((polygon) => {
    if (polygon.exterior.length < 3) return [];
    const [x0, y0, x1, y1] = componentsBounds([polygon]);
    if (![x0, y0, x1, y1].every(Number.isFinite)) return [];
    const origin: Point = [Math.floor(x0) - 1, Math.floor(y0) - 1];
    const width = Math.ceil(x1) - origin[0] + 2; const height = Math.ceil(y1) - origin[1] + 2;
    const mask = new Uint8Array(width * height);
    rasterRing(mask, width, height, polygon.exterior, 1, origin);
    polygon.holes.forEach((hole) => rasterRing(mask, width, height, hole, 0, origin));
    const depth = Float32Array.from(mask, (v) => (v ? Infinity : 0));
    // OpenCV DIST_L2, mask size 3: axial 0.955, diagonal 1.3693.
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (mask[i]) {
          depth[i] = Math.min(
            depth[i],
            depth[i - 1] + 0.955,
            depth[i - width] + 0.955,
            depth[i - width - 1] + 1.3693,
            depth[i - width + 1] + 1.3693,
          );
        }
      }
    }
    let deepest = 0;
    for (let y = height - 2; y > 0; y -= 1) {
      for (let x = width - 2; x > 0; x -= 1) {
        const i = y * width + x;
        if (mask[i]) {
          depth[i] = Math.min(
            depth[i],
            depth[i + 1] + 0.955,
            depth[i + width] + 0.955,
            depth[i + width - 1] + 1.3693,
            depth[i + width + 1] + 1.3693,
          );
        }
      }
    }
    for (let i = 0; i < depth.length; i += 1) if (depth[i] > depth[deepest]) deepest = i;
    if (!depth[deepest] || !Number.isFinite(depth[deepest])) return [];
    const candidates: number[] = [];
    const minDepth = Math.fround(depth[deepest] / 3);
    for (let i = 0; i < depth.length; i += 1) if (depth[i] >= minDepth) candidates.push(i);
    const point = (i: number): Point => [(i % width) + origin[0], Math.floor(i / width) + origin[1]];
    const result = [point(deepest)];
    const distances = new Float64Array(candidates.length).fill(Infinity);
    while (result.length < count) {
      const last = result[result.length - 1]; let farthest = 0;
      candidates.forEach((i, j) => {
        const p = point(i);
        distances[j] = Math.min(distances[j], (p[0] - last[0]) ** 2 + (p[1] - last[1]) ** 2);
        if (distances[j] > distances[farthest]) farthest = j;
      });
      if (distances[farthest] <= 0) break;
      result.push(point(candidates[farthest]));
    }
    return result;
  });
}

/** Remove correspondences whose offsets disagree with the component median. */
export function consistentMaskSeeds(points: Point[], warped: (Point | null)[], polygon: SegmentationPolygon): Point[] {
  const matches = points.flatMap((p, i) => (warped[i] ? [{ point: warped[i]!, shift: [warped[i]![0] - p[0], warped[i]![1] - p[1]] }] : []));
  if (!matches.length) return [];
  const median = (axis: number) => {
    const values = matches.map((m) => m.shift[axis]).sort((a, b) => a - b);
    return (values[Math.floor(values.length / 2)] + values[Math.floor((values.length - 1) / 2)]) / 2;
  };
  const mx = median(0); const my = median(1);
  const [x0, y0, x1, y1] = componentsBounds([polygon]);
  const tolerance = Math.max(4, 0.1 * Math.hypot(x1 - x0, y1 - y0));
  return matches.filter((m) => Math.hypot(m.shift[0] - mx, m.shift[1] - my) <= tolerance).map((m) => m.point);
}

export function maskArea(polygons: SegmentationPolygon[]): number {
  return polygons.reduce((sum, p) => sum + Math.max(0, Math.abs(polygonArea(p.exterior))
    - p.holes.reduce((area, hole) => area + Math.abs(polygonArea(hole)), 0)), 0);
}
