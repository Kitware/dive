/**
 * One mask from the segmentation service can hold several components, each
 * with holes. These helpers turn that list into the keyed polygon features a
 * detection stores, and back into the bounds and keys the callers need.
 */
import type { SegmentationPolygon } from 'dive-common/apispec';
import type { RectBounds } from 'vue-media-annotator/utils';

export type Point = [number, number];

/** The mask's components; a legacy single exterior becomes one component. */
export function segmentationComponents(
  result: { polygon?: Point[] | null; polygons?: SegmentationPolygon[] | null },
): SegmentationPolygon[] {
  const components = result.polygons?.length
    ? result.polygons
    : [{ exterior: result.polygon ?? [], holes: [] }];
  return components.filter((component) => component.exterior.length >= 3);
}

/** Closed ring for a service polygon (the service returns open ones). */
export function closedRing(ring: Point[]): Point[] {
  const closed = ring.map((p) => [...p] as Point);
  const [first] = closed;
  const last = closed[closed.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) closed.push([...first] as Point);
  return closed;
}

export function componentsBounds(components: SegmentationPolygon[]): RectBounds {
  const xs = components.flatMap((c) => c.exterior.map((p) => p[0]));
  const ys = components.flatMap((c) => c.exterior.map((p) => p[1]));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Key of the index-th component: the base key, then base-1, base-2, ... */
export function segmentationPolygonKey(base: string, index: number): string {
  return index === 0 ? base : `${base}-${index}`;
}

export function isSegmentationPolygonKey(key: string, base: string): boolean {
  return key === base || key.startsWith(`${base}-`);
}

export function segmentationPolygonFeatures(
  components: SegmentationPolygon[],
  base: string,
): GeoJSON.Feature<GeoJSON.Polygon>[] {
  return components.map((component, index) => ({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [closedRing(component.exterior), ...component.holes.map(closedRing)],
    },
    properties: { key: segmentationPolygonKey(base, index) },
  }));
}
