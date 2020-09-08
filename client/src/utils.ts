import { difference } from 'lodash';

// [x1, y1, x2, y2] as (left, top), (bottom, right)
export type RectBounds = [number, number, number, number];

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

/**
 *  Removing a point for a Line is different than a polygon
 * @param data
 */
function removePoint(
  data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>, index: number,
): boolean {
  if (data.geometry.type === 'Polygon') {
    if (data.geometry.coordinates[0].length > 3) {
      data.geometry.coordinates[0].splice(index, 1);
      return true;
    }
    console.warn('Polygons must have at least 3 points');
    return false;
  }
  if (data.geometry.coordinates.length > 2) { //Handling a Line
    data.geometry.coordinates.splice(index, 1);
    return true;
  }
  if (data.geometry.type === 'LineString' && data.geometry.coordinates.length === 2) {
    console.warn('Lines must have at least 2 points');
    return false;
  }
  return true;
}

function updateBounds(
  oldBounds: RectBounds | undefined,
  union: GeoJSON.Polygon[],
  unionNoBounds: GeoJSON.Polygon[],
): RectBounds {
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
    poly.coordinates.forEach((pos) => {
      pos.forEach((point) => {
        limits.xLow = Math.min(limits.xLow, point[0]);
        limits.xHigh = Math.max(limits.xHigh, point[0]);
        limits.yLow = Math.min(limits.yLow, point[1]);
        limits.yHigh = Math.max(limits.yHigh, point[1]);
      });
    });
  });
  // console.log('yes', union, unionNoBounds);
  return [limits.xLow, limits.yLow, limits.xHigh, limits.yHigh];
}

export {
  boundToGeojson,
  // findBounds,
  updateBounds,
  geojsonToBound,
  updateSubset,
  removePoint,
};
