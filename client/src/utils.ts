import { AxiosError } from 'axios';
import { difference } from 'lodash';

// [x1, y1, x2, y2] as (left, top), (bottom, right)
export type RectBounds = [number, number, number, number];

// Rotation-related constants
/** Threshold for considering rotation significant (radians) */
export const ROTATION_THRESHOLD = 0.001;
/** Attribute name for storing rotation in detection attributes */
export const ROTATION_ATTRIBUTE_NAME = 'rotation';

// Reserved attribute names - these cannot be used by users when creating attributes
/** Reserved detection attribute names */
export const RESERVED_DETECTION_ATTRIBUTES = ['rotation', 'userModified'] as const;
/** Reserved track attribute names */
export const RESERVED_TRACK_ATTRIBUTES = ['userCreated'] as const;

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
  if (belongs === 'detection') {
    return RESERVED_DETECTION_ATTRIBUTES.includes(name as typeof RESERVED_DETECTION_ATTRIBUTES[number]);
  }
  return RESERVED_TRACK_ATTRIBUTES.includes(name as typeof RESERVED_TRACK_ATTRIBUTES[number]);
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

function getResponseError(error: AxiosError): string {
  const { response } = error;
  return String(response?.data?.message || response?.data || error);
}

function withinBounds(coord: [number, number], bounds: RectBounds) {
  const x = coord[0];
  const y = coord[1];
  return (x > bounds[0] && x < bounds[2] && y > bounds[1] && y < bounds[3]);
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
 * Calculate rotation angle in radians from a rotated rectangle polygon
 * Returns the angle of the first edge (from first to second point) relative to horizontal
 */
function calculateRotationFromPolygon(coords: GeoJSON.Position[]): number {
  if (coords.length < 2) {
    return 0;
  }
  // Get the first edge vector (from first point to second point)
  const dx = coords[1][0] - coords[0][0];
  const dy = coords[1][1] - coords[0][1];
  // Calculate angle using atan2
  return Math.atan2(dy, dx);
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
 * Convert a rotated rectangle polygon to an axis-aligned bounding box.
 *
 * This function handles the conversion between the display representation
 * (rotated polygon) and the storage representation (axis-aligned bbox + rotation).
 *
 * The rotation is calculated from the first edge of the polygon.
 * The resulting bbox is the smallest axis-aligned rectangle that would
 * contain the original rotated rectangle when unrotated.
 *
 * @param coords - Polygon coordinates (should be 4-5 points for a rectangle)
 * @returns Object containing:
 *   - bounds: Axis-aligned bounding box [x1, y1, x2, y2]
 *   - rotation: Rotation angle in radians (0 if axis-aligned)
 *
 * @example
 * // Rotated rectangle at 45 degrees
 * const coords = [[0,0], [0,10], [10,10], [10,0], [0,0]];
 * const { bounds, rotation } = rotatedPolygonToAxisAlignedBbox(coords);
 * // bounds: [0, 0, 10, 10] (or similar)
 * // rotation: ~0.785 (45 degrees in radians)
 */
function rotatedPolygonToAxisAlignedBbox(
  coords: GeoJSON.Position[],
): { bounds: RectBounds; rotation: number } {
  try {
    if (coords.length < 4) {
      // Fallback to simple bounding box calculation
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      coords.forEach((coord) => {
        x1 = Math.min(x1, coord[0]);
        y1 = Math.min(y1, coord[1]);
        x2 = Math.max(x2, coord[0]);
        y2 = Math.max(y2, coord[1]);
      });
      return { bounds: [x1, y1, x2, y2], rotation: 0 };
    }

    // Validate that we have a proper rectangle (4 distinct corners + optional closing point)
    const distinctPoints = coords.slice(0, Math.min(4, coords.length));
    if (distinctPoints.length < 4) {
      // Fallback to simple bbox
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      distinctPoints.forEach((coord) => {
        x1 = Math.min(x1, coord[0]);
        y1 = Math.min(y1, coord[1]);
        x2 = Math.max(x2, coord[0]);
        y2 = Math.max(y2, coord[1]);
      });
      return { bounds: [x1, y1, x2, y2], rotation: 0 };
    }

    // Check if rectangle is already axis-aligned
    if (isAxisAligned(coords)) {
      // Already axis-aligned, just calculate bounds
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      coords.forEach((coord) => {
        x1 = Math.min(x1, coord[0]);
        y1 = Math.min(y1, coord[1]);
        x2 = Math.max(x2, coord[0]);
        y2 = Math.max(y2, coord[1]);
      });
      return { bounds: [x1, y1, x2, y2], rotation: 0 };
    }

    // Rectangle is rotated - calculate original axis-aligned bbox by unrotating
    const rotation = calculateRotationFromPolygon(coords);

    // Calculate center of the rotated rectangle
    let centerX = 0;
    let centerY = 0;
    const numPoints = Math.min(4, coords.length - 1); // Exclude duplicate last point
    for (let i = 0; i < numPoints; i += 1) {
      centerX += coords[i][0];
      centerY += coords[i][1];
    }
    centerX /= numPoints;
    centerY /= numPoints;

    // Unrotate all points by -rotation around center
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const unrotatedPoints: GeoJSON.Position[] = [];
    for (let i = 0; i < numPoints; i += 1) {
      const x = coords[i][0] - centerX;
      const y = coords[i][1] - centerY;
      const unrotatedX = x * cos - y * sin;
      const unrotatedY = x * sin + y * cos;
      unrotatedPoints.push([unrotatedX + centerX, unrotatedY + centerY]);
    }

    // Calculate axis-aligned bounding box from unrotated points
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    unrotatedPoints.forEach((coord) => {
      x1 = Math.min(x1, coord[0]);
      y1 = Math.min(y1, coord[1]);
      x2 = Math.max(x2, coord[0]);
      y2 = Math.max(y2, coord[1]);
    });

    return { bounds: [x1, y1, x2, y2], rotation };
  } catch (error) {
    console.error('Error converting rotated polygon to bbox:', error);
    // Fallback to simple bbox calculation
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    coords.forEach((coord) => {
      x1 = Math.min(x1, coord[0]);
      y1 = Math.min(y1, coord[1]);
      x2 = Math.max(x2, coord[0]);
      y2 = Math.max(y2, coord[1]);
    });
    return { bounds: [x1, y1, x2, y2], rotation: 0 };
  }
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
 * Apply rotation to an axis-aligned bounding box polygon.
 *
 * Coordinate System:
 * - Assumes image coordinates where (0,0) is top-left
 * - Y-axis increases downward
 * - Rotation is counter-clockwise in radians (matching GeoJS convention)
 * - Bounds format: [x1, y1, x2, y2] where (x1,y1) is top-left, (x2,y2) is bottom-right
 *
 * @param polygon - The axis-aligned polygon
 * @param bounds - The bounding box [x1, y1, x2, y2] in image coordinates
 * @param rotation - Rotation angle in radians (counter-clockwise)
 * @returns Rotated polygon
 */
export function applyRotationToPolygon(
  polygon: GeoJSON.Polygon,
  bounds: RectBounds,
  rotation: number,
): GeoJSON.Polygon {
  // Calculate center of the bounding box
  const centerX = (bounds[0] + bounds[2]) / 2;
  const centerY = (bounds[1] + bounds[3]) / 2;

  // Calculate width and height
  const width = bounds[2] - bounds[0];
  const height = bounds[3] - bounds[1];

  // Half dimensions
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  // Rotation matrix components
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // Transform the four corners
  const corners = [
    [-halfWidth, -halfHeight], // bottom-left (relative to center)
    [-halfWidth, halfHeight], // top-left
    [halfWidth, halfHeight], // top-right
    [halfWidth, -halfHeight], // bottom-right
  ];

  const rotatedCorners = corners.map(([x, y]) => {
    // Apply rotation
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;
    // Translate back to world coordinates
    return [rotatedX + centerX, rotatedY + centerY] as [number, number];
  });

  // Return polygon with rotated corners (close the polygon)
  return {
    type: 'Polygon',
    coordinates: [
      [
        rotatedCorners[0],
        rotatedCorners[1],
        rotatedCorners[2],
        rotatedCorners[3],
        rotatedCorners[0], // Close the polygon
      ],
    ],
  };
}

export {
  getResponseError,
  boundToGeojson,
  // findBounds,
  updateBounds,
  geojsonToBound,
  updateSubset,
  removePoint,
  reOrderBounds,
  reOrdergeoJSON,
  withinBounds,
  frameToTimestamp,
  calculateRotationFromPolygon,
  isAxisAligned,
  rotatedPolygonToAxisAlignedBbox,
};
