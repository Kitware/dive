import axios from 'axios';
import { difference } from 'lodash';
// Type-only import (erased at runtime) so the utils <-> track cycle is safe.
import type { Feature } from './track';

// [x1, y1, x2, y2] as (left, top), (bottom, right)
export type RectBounds = [number, number, number, number];

/**
 * True when a track feature already carries a segmentation mask: a Polygon
 * under the selected key. Point-click segmentation commits its mask as that
 * polygon (the prompt points themselves are never stored on the track), so
 * cross-camera segmentation uses this to decide whether a camera still
 * accepts a point click for the selected detection -- a detection that only
 * has a box (e.g. from a pipeline) must still accept one.
 */
export function featureHasSegmentationPolygon(
  feature: Feature | null,
  selectedKey: string,
): boolean {
  if (!feature) return false;
  return (feature.geometry?.features || []).some(
    (f) => f.geometry.type === 'Polygon' && (f.properties?.key ?? '') === selectedKey,
  );
}

// Rotation-related constants
/** Threshold for considering rotation significant (radians) */
export const ROTATION_THRESHOLD = 0.001;
/** Attribute name for storing rotation in detection attributes */
export const ROTATION_ATTRIBUTE_NAME = 'rotation';

// Reserved attribute names - these cannot be used by users when creating attributes
/** Reserved detection attribute names */
export const RESERVED_ATTRIBUTES: Record<'track' | 'detection', readonly string[]> = {
  track: ['userCreated'],
  detection: ['rotation', 'userModified'],
} as const;

/**
 * Check if an attribute name is reserved for the given attribute type
 * @param name - Attribute name to check
 * @param belongs - Whether this is a 'track' or 'detection' attribute
 * @returns True if the name is reserved
 */
export function isReservedAttributeName(
  name: string,
  belongs: 'track' | 'detection',
): boolean {
  return RESERVED_ATTRIBUTES[belongs].includes(name);
}

/*
 * updateSubset keeps a subset up to date when its superset
 * changes.  Takes the old and new array values of the superset,
 * removes and adds changed values.  If a value is in both old and new superset
 * and omitted from subset, it will remain omitted.  If old and new are
 * the same, it will return null
 */
function updateSubset<T>(
  oldsuper: Readonly<T[]>,
  newsuper: Readonly<T[]>,
  subarr: Readonly<T[]>,
): T[] | null {
  const addedValues = difference(newsuper, oldsuper);
  const removedValues = difference(oldsuper, newsuper);
  if (!addedValues.length && !removedValues.length) {
    return null;
  }
  const subset = new Set(subarr);
  addedValues.forEach((v) => subset.add(v));
  removedValues.forEach((v) => subset.delete(v));
  return Array.from(subset);
}

/* beginning at bottom left, rectangle is defined clockwise */
function geojsonToBound(geojson: GeoJSON.Feature<GeoJSON.Polygon>): RectBounds {
  const coords = geojson.geometry.coordinates[0];
  return [coords[1][0], coords[1][1], coords[3][0], coords[3][1]];
}

function boundToGeojson(bounds: RectBounds): GeoJSON.Polygon {
  /* return clockwise 5 point rectangle beginning with (x1, y2) (bottom left)
   * because that's what GeoJS likes
   */
  return {
    type: 'Polygon',
    coordinates: [
      [
        [bounds[0], bounds[3]],
        [bounds[0], bounds[1]],
        [bounds[2], bounds[1]],
        [bounds[2], bounds[3]],
        [bounds[0], bounds[3]],
      ],
    ],
  };
}

export type Point2D = { x: number; y: number };

/** Ray-cast point-in-ring test (open or closed rings). */
export function pointInRing(point: Point2D, ring: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const { x: xi, y: yi } = ring[i];
    const { x: xj, y: yj } = ring[j];
    if (((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Point-in-polygon with optional holes: inside the outer ring and outside
 * every hole.
 */
export function pointInPolygon(
  point: Point2D,
  outer: Point2D[],
  holes: Point2D[][] = [],
): boolean {
  if (!pointInRing(point, outer)) {
    return false;
  }
  return !holes.some((hole) => pointInRing(point, hole));
}

/** Area of an axis-aligned rect bounds tuple [xmin, ymin, xmax, ymax]. */
export function rectBoundsArea(bounds: RectBounds): number {
  return Math.abs((bounds[2] - bounds[0]) * (bounds[3] - bounds[1]));
}

function removePoint(data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>, index: number): boolean {
  if (data.geometry.type === 'Polygon') {
    const coords = data.geometry.coordinates[0];
    const second = coords[1];
    // Polygons must have 3 points, but the first and last are always the same
    if (coords.length > 4) {
      if (index === 0 || index === coords.length - 1) {
        // Replace the last point with the second,
        // the first is about to be removed
        // A B C D A --> B C D B
        coords.splice(coords.length - 1, 1, second);
      }
      coords.splice(index, 1);
      return true;
    }
    console.warn('Polygons must have at least 3 points');
    return false;
  }
  return false;
}

function updateBounds(
  oldBounds: RectBounds | undefined,
  union: GeoJSON.Polygon[],
  unionNoBounds: GeoJSON.Polygon[],
): RectBounds | undefined {
  if (!oldBounds && union.length === 0 && unionNoBounds.length === 0) {
    // nothing to do, skip bounds update
    return undefined;
  }
  const limits = {
    xLow: Infinity,
    yLow: Infinity,
    xHigh: -Infinity,
    yHigh: -Infinity,
  };
  if (oldBounds && unionNoBounds.length === 0) {
    [
      limits.xLow,
      limits.yLow,
      limits.xHigh,
      limits.yHigh,
    ] = oldBounds;
  }
  union.concat(unionNoBounds).forEach((poly) => {
    poly.coordinates.forEach((posarr) => {
      posarr.forEach((pos) => {
        limits.xLow = Math.min(limits.xLow, pos[0]);
        limits.xHigh = Math.max(limits.xHigh, pos[0]);
        limits.yLow = Math.min(limits.yLow, pos[1]);
        limits.yHigh = Math.max(limits.yHigh, pos[1]);
      });
    });
  });
  return [limits.xLow, limits.yLow, limits.xHigh, limits.yHigh];
}

/**
 * This will take the current geoJSON Coordinates for a rectangle and reorder it
 * to keep the vertices index the same with respect to how geoJS uses it
 * Example: UL, LL, LR, UR, UL
 */
function reOrdergeoJSON(coords: GeoJSON.Position[]) {
  let x1 = Infinity;
  let x2 = -Infinity;
  let y1 = Infinity;
  let y2 = -Infinity;
  coords.forEach((coord) => {
    x1 = Math.min(x1, coord[0]);
    x2 = Math.max(x2, coord[0]);
    y1 = Math.min(y1, coord[1]);
    y2 = Math.max(y2, coord[1]);
  });
  return [
    [x1, y2],
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

/**
 * Reorients RectBounds by reording to prevent mirroring across the x or y axis
 * Example: xmin, ymin, xmax, ymax
 */
function reOrderBounds(bounds: RectBounds) {
  const x1 = bounds[0] < bounds[2] ? bounds[0] : bounds[2];
  const x2 = bounds[0] < bounds[2] ? bounds[2] : bounds[0];
  const y1 = bounds[1] < bounds[3] ? bounds[1] : bounds[3];
  const y2 = bounds[1] < bounds[3] ? bounds[3] : bounds[1];
  return [x1, y1, x2, y2];
}

function getResponseError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (data && typeof data === 'object' && data !== null && 'message' in data) {
      const { message } = data as { message: unknown };
      if (typeof message === 'string') {
        return message;
      }
    }
    return String(data ?? error.message);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function withinBounds(coord: [number, number], bounds: RectBounds) {
  const x = coord[0];
  const y = coord[1];
  return (x > bounds[0] && x < bounds[2] && y > bounds[1] && y < bounds[3]);
}

/**
 * Inclusive test that every vertex of a polygon lies within the given
 * axis-aligned bounds [x1, y1, x2, y2].
 */
function polygonWithinBounds(polygon: GeoJSON.Polygon, bounds: RectBounds): boolean {
  return polygon.coordinates.every((ring) => ring.every((pos) => (
    pos[0] >= bounds[0] && pos[0] <= bounds[2] && pos[1] >= bounds[1] && pos[1] <= bounds[3]
  )));
}

/**
 * Translate every vertex of a polygon by (dx, dy). Holes move with the exterior.
 */
function translatePolygon(
  polygon: GeoJSON.Polygon,
  dx: number,
  dy: number,
): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: polygon.coordinates.map((ring) => (
      ring.map((pos) => [pos[0] + dx, pos[1] + dy])
    )),
  };
}

/**
 * True when `next` is the same width/height as `prev` but at a different origin
 * (a pure translation / box move, not a resize).
 */
function isBoundsTranslation(prev: RectBounds, next: RectBounds): boolean {
  return (prev[2] - prev[0]) === (next[2] - next[0])
    && (prev[3] - prev[1]) === (next[3] - next[1])
    && (prev[0] !== next[0] || prev[1] !== next[1]);
}

/**
 * True when the polygon is just the full axis-aligned rectangle of `bounds`:
 * no holes, its extent matches the bounds, and its area fills the whole box
 * (a simple polygon whose area equals its bounding box's area must be that
 * rectangle). Such a polygon carries no information beyond the box itself.
 */
function polygonEqualsBounds(
  polygon: GeoJSON.Polygon,
  bounds: RectBounds,
  tolerance = 1e-3,
): boolean {
  if (polygon.coordinates.length !== 1) {
    return false;
  }
  const ring = polygon.coordinates[0];
  if (ring.length < 4) {
    return false;
  }
  let xLow = Infinity;
  let yLow = Infinity;
  let xHigh = -Infinity;
  let yHigh = -Infinity;
  ring.forEach(([x, y]) => {
    xLow = Math.min(xLow, x);
    yLow = Math.min(yLow, y);
    xHigh = Math.max(xHigh, x);
    yHigh = Math.max(yHigh, y);
  });
  if (Math.abs(xLow - bounds[0]) > tolerance || Math.abs(yLow - bounds[1]) > tolerance
    || Math.abs(xHigh - bounds[2]) > tolerance || Math.abs(yHigh - bounds[3]) > tolerance) {
    return false;
  }
  // Shoelace area over the open ring (GeoJSON rings repeat the first point)
  const open = (ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1]) ? ring.slice(0, -1) : ring;
  let area = 0;
  for (let i = 0; i < open.length; i += 1) {
    const [x1, y1] = open[i];
    const [x2, y2] = open[(i + 1) % open.length];
    area += (x1 * y2) - (x2 * y1);
  }
  area = Math.abs(area) / 2;
  const boxArea = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
  return Math.abs(area - boxArea) <= tolerance * Math.max(1, boxArea);
}

/* Clip one open linear ring against a single half-plane (Sutherland–Hodgman step) */
function clipRingAgainstEdge(
  points: GeoJSON.Position[],
  inside: (pos: GeoJSON.Position) => boolean,
  intersect: (a: GeoJSON.Position, b: GeoJSON.Position) => GeoJSON.Position,
): GeoJSON.Position[] {
  const output: GeoJSON.Position[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const previous = points[(i + points.length - 1) % points.length];
    if (inside(current)) {
      if (!inside(previous)) {
        output.push(intersect(previous, current));
      }
      output.push(current);
    } else if (inside(previous)) {
      output.push(intersect(previous, current));
    }
  }
  return output;
}

/**
 * Clip a polygon to axis-aligned bounds [x1, y1, x2, y2] using the
 * Sutherland–Hodgman algorithm. Holes are clipped as well; a hole left
 * with fewer than 3 points is dropped. Returns null when the exterior
 * ring falls entirely outside the bounds.
 */
function clipPolygonToBounds(
  polygon: GeoJSON.Polygon,
  bounds: RectBounds,
): GeoJSON.Polygon | null {
  const [x1, y1, x2, y2] = bounds;
  const edges: [
    (pos: GeoJSON.Position) => boolean,
    (a: GeoJSON.Position, b: GeoJSON.Position) => GeoJSON.Position,
  ][] = [
    [
      (pos) => pos[0] >= x1,
      (a, b) => [x1, a[1] + (((x1 - a[0]) / (b[0] - a[0])) * (b[1] - a[1]))],
    ],
    [
      (pos) => pos[0] <= x2,
      (a, b) => [x2, a[1] + (((x2 - a[0]) / (b[0] - a[0])) * (b[1] - a[1]))],
    ],
    [
      (pos) => pos[1] >= y1,
      (a, b) => [a[0] + (((y1 - a[1]) / (b[1] - a[1])) * (b[0] - a[0])), y1],
    ],
    [
      (pos) => pos[1] <= y2,
      (a, b) => [a[0] + (((y2 - a[1]) / (b[1] - a[1])) * (b[0] - a[0])), y2],
    ],
  ];
  const rings: GeoJSON.Position[][] = [];
  for (let i = 0; i < polygon.coordinates.length; i += 1) {
    // Work on the open ring; GeoJSON rings repeat the first point at the end
    let clipped = polygon.coordinates[i].slice(0, -1);
    edges.forEach(([inside, intersect]) => {
      clipped = clipRingAgainstEdge(clipped, inside, intersect);
    });
    if (clipped.length >= 3) {
      rings.push([...clipped, clipped[0]]);
    } else if (i === 0) {
      // Exterior ring is entirely outside: the polygon is gone
      return null;
    }
  }
  return { type: 'Polygon', coordinates: rings };
}

function frameToTimestamp(frame: number, frameRate: number): string | null {
  const ms = (frame / frameRate) * 1000;
  const date = new Date(ms);

  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC', // important!
  }).format(date);
}

/**
 * Compute the centroid of a GeoJSON coordinate array.
 * For closed polygons (first point equals last), the duplicate is excluded.
 *
 * @param coords - GeoJSON Position array
 * @returns [x, y] centroid or null if empty
 */
function getCentroid(coords: GeoJSON.Position[]): [number, number] | null {
  if (coords.length === 0) return null;
  let pts = coords;
  if (
    coords.length > 1
    && coords[0][0] === coords[coords.length - 1][0]
    && coords[0][1] === coords[coords.length - 1][1]
  ) {
    pts = coords.slice(0, -1);
  }
  const [sx, sy] = pts.reduce(
    (acc, p) => [acc[0] + p[0], acc[1] + p[1]],
    [0, 0],
  );
  return [sx / pts.length, sy / pts.length];
}

/**
 * Given two GeoJSON coordinate arrays, compute the centroid of each and the
 * rotation (in radians) from the first array's orientation to the second's.
 *
 * The orientation of each array is taken as the angle from its centroid to
 * its first point. The returned value is the angle you would rotate the first
 * shape to align with the second (counter‑clockwise positive).
 *
 * @param coordsA - First coordinate array
 * @param coordsB - Second coordinate array
 * @returns Rotation in radians (coordsB angle minus coordsA angle), or 0 if
 *   either array is empty or centroids cannot be computed
 */
export function getRotationBetweenCoordinateArrays(
  coordsA: GeoJSON.Position[],
  coordsB: GeoJSON.Position[],
): number {
  const centerA = getCentroid(coordsA);
  const centerB = getCentroid(coordsB);
  if (!centerA || !centerB) return 0;

  const dxA = coordsA[0][0] - centerA[0];
  const dyA = coordsA[0][1] - centerA[1];
  const dxB = coordsB[0][0] - centerB[0];
  const dyB = coordsB[0][1] - centerB[1];

  const angleA = Math.atan2(dyA, dxA);
  const angleB = Math.atan2(dyB, dxB);
  return angleB - angleA;
}

/**
 * Normalize an angle difference to [-π, π].
 */
function normalizeAngleDiff(rad: number): number {
  let d = rad;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Get the angle (radians) of an edge from coords[i] to coords[i+1].
 * For closed polygons, coords[coords.length - 1] may equal coords[0]; we use
 * indices modulo 4 so edge 3 is from coords[3] to coords[0].
 */
function getEdgeAngle(coords: GeoJSON.Position[], edgeIndex: number): number {
  const n = 4;
  const i = edgeIndex % n;
  const j = (i + 1) % n;
  const a = coords[i];
  const b = coords[j];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.atan2(dy, dx);
}

/**
 * Returns true if the two rectangle coordinate arrays have the same edge
 * orientations (sides are parallel). Used to distinguish resize-only edits
 * from rotation: if the new rect's sides are parallel to the old rect's,
 * we keep the existing rotation instead of recomputing from centroid/vertex.
 */
export function areRectangleSidesParallel(
  oldCoords: GeoJSON.Position[],
  newCoords: GeoJSON.Position[],
): boolean {
  if (oldCoords.length < 4 || newCoords.length < 4) {
    return false;
  }
  for (let e = 0; e < 4; e += 1) {
    const angleOld = getEdgeAngle(oldCoords, e);
    const angleNew = getEdgeAngle(newCoords, e);
    const diff = normalizeAngleDiff(angleNew - angleOld);
    if (Math.abs(diff) > ROTATION_THRESHOLD) {
      return false;
    }
  }
  return true;
}

/**
 * Check if a rectangle is axis-aligned (not rotated)
 * Returns true if edges are parallel to axes (within a small threshold)
 */
function isAxisAligned(coords: GeoJSON.Position[]): boolean {
  if (coords.length < 4) {
    return true;
  }

  // Check if first edge is horizontal or vertical
  const dx1 = coords[1][0] - coords[0][0];
  const dy1 = coords[1][1] - coords[0][1];
  const isHorizontal = Math.abs(dy1) < ROTATION_THRESHOLD;
  const isVertical = Math.abs(dx1) < ROTATION_THRESHOLD;

  // Check if second edge is perpendicular to first
  const dx2 = coords[2][0] - coords[1][0];
  const dy2 = coords[2][1] - coords[1][1];
  const isPerpendicular = Math.abs(dx1 * dx2 + dy1 * dy2) < ROTATION_THRESHOLD;

  return (isHorizontal || isVertical) && isPerpendicular;
}

/**
 * Type guard to check if a value is a valid rotation number
 */
export function isRotationValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates and normalizes a rotation value
 * @param rotation - Rotation angle in radians
 * @returns Normalized rotation value or undefined if invalid
 */
export function validateRotation(rotation: number | undefined | null): number | undefined {
  if (rotation === undefined || rotation === null) {
    return undefined;
  }

  // Check for invalid numbers
  if (!Number.isFinite(rotation)) {
    console.warn('Invalid rotation value:', rotation);
    return undefined;
  }

  // Normalize to [-π, π] range
  // This prevents accumulation of large rotation values
  let normalized = rotation;
  while (normalized > Math.PI) normalized -= 2 * Math.PI;
  while (normalized < -Math.PI) normalized += 2 * Math.PI;

  // Return undefined if effectively zero
  if (Math.abs(normalized) < ROTATION_THRESHOLD) {
    return undefined;
  }

  return normalized;
}

/**
 * Get rotation from track features attributes
 * @param attributes - Feature attributes object
 * @returns Rotation value in radians, or undefined if not present/invalid
 */
export function getRotationFromAttributes(
  attributes: Record<string, unknown> | undefined,
): number | undefined {
  if (!attributes) return undefined;
  const rotation = attributes[ROTATION_ATTRIBUTE_NAME];
  return isRotationValue(rotation) ? rotation : undefined;
}

/**
 * Check if rotation is significant (non-zero within threshold)
 * @param rotation - Rotation angle in radians
 * @returns True if rotation is significant
 */
export function hasSignificantRotation(rotation: number | undefined | null): boolean {
  if (rotation === undefined || rotation === null) return false;
  return Math.abs(rotation) > ROTATION_THRESHOLD;
}

/**
 * Get a small arrow LineString at the midpoint of the right edge of a rotated bbox,
 * pointing outward. Used to indicate rotation direction. Returns null if rotation
 * is not significant.
 *
 * The "right" edge is the edge at +halfWidth in local bbox coords (the vertical
 * edge at max X when rotation is 0), so the arrow stays on that side for any rotation.
 *
 * @param bounds - Axis-aligned bbox [x1, y1, x2, y2]
 * @param rotation - Rotation in radians (counter-clockwise)
 * @returns GeoJSON LineString (chevron) or null if rotation is not significant
 */
function getRotationArrowLine(
  bounds: RectBounds,
  rotation: number,
): GeoJSON.LineString | null {
  if (!hasSignificantRotation(rotation)) return null;

  const centerX = bounds[0] + (bounds[2] - bounds[0]) / 2;
  const centerY = bounds[1] + (bounds[3] - bounds[1]) / 2;
  const center = [centerX, centerY];
  const width = bounds[2] - bounds[0];
  const height = bounds[3] - bounds[1];

  const rightMidPoint = [bounds[2], center[1]];

  // draw a small arrow on the right edge of the bounding box
  // the arrow is pointing outward from the right edge
  // the arrow is a triangle with a base and a tip
  const arrowLength = Math.min(width, height) * 0.12;
  const arrowTopBase = [
    rightMidPoint[0] + 5,
    rightMidPoint[1] + arrowLength * 0.5,
  ];
  const arrowTip = [
    rightMidPoint[0] + arrowLength,
    rightMidPoint[1],
  ];
  const arrowBottomBase = [
    rightMidPoint[0] + 5,
    rightMidPoint[1] - arrowLength * 0.5,
  ];

  const arrowRightCoordinates = [
    arrowTopBase,
    arrowTip,
    arrowBottomBase,
  ];
  const rotatedArrowCoordinates = arrowRightCoordinates.map((pt) => rotatedPointAboutCenter(center as [number, number], pt as [number, number], rotation)) as GeoJSON.Position[];

  return {
    type: 'LineString',
    coordinates: rotatedArrowCoordinates,
  };
}

function rotatedPointAboutCenter(center: [number, number], point: [number, number], rotation: number): [number, number] {
  const x = point[0] - center[0];
  const y = point[1] - center[1];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [x * cos - y * sin + center[0], x * sin + y * cos + center[1]];
}

function rotateGeoJSONCoordinates(coordinates: GeoJSON.Position[], rotation: number): GeoJSON.Position[] {
  const center = getCentroid(coordinates);
  if (!center) return coordinates;
  return coordinates.map((coord) => rotatedPointAboutCenter(center, [coord[0], coord[1]], rotation)) as GeoJSON.Position[];
}

export {
  getResponseError,
  boundToGeojson,
  getRotationArrowLine,
  rotatedPointAboutCenter,
  rotateGeoJSONCoordinates,
  // findBounds,
  updateBounds,
  geojsonToBound,
  updateSubset,
  removePoint,
  reOrderBounds,
  reOrdergeoJSON,
  withinBounds,
  polygonWithinBounds,
  polygonEqualsBounds,
  translatePolygon,
  isBoundsTranslation,
  clipPolygonToBounds,
  frameToTimestamp,
  isAxisAligned,
};
