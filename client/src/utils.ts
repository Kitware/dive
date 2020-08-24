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

function findBounds(polygon: GeoJSON.Polygon): RectBounds {
  const coords = polygon.coordinates[0];
  const limits = {
    xLow: Infinity,
    xHigh: -Infinity,
    yLow: Infinity,
    yHigh: -Infinity,
  };
  coords.forEach(([xCoord, yCoord]) => {
    limits.xLow = Math.min(xCoord, limits.xLow);
    limits.xHigh = Math.max(xCoord, limits.xHigh);
    limits.yLow = Math.min(yCoord, limits.yLow);
    limits.yHigh = Math.max(yCoord, limits.yHigh);
  });
  //Now we create some bounds from our 4 points
  return [limits.xLow, limits.yLow, limits.xHigh, limits.yHigh];
}

export {
  boundToGeojson,
  findBounds,
  geojsonToBound,
  updateSubset,
};
