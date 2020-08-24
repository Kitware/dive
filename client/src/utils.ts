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
  data:
  GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>, index: number,
) {
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


function findBounds(
  data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>,
): RectBounds {
  let coords;
  if (data.geometry.type === 'Polygon') {
    // eslint-disable-next-line prefer-destructuring
    coords = data.geometry.coordinates[0];
  } else if (data.geometry.type === 'LineString') {
    coords = data.geometry.coordinates;
  }
  const limits = {
    xLow: Infinity,
    xHigh: -Infinity,
    yLow: Infinity,
    yHigh: -Infinity,
  };
  if (data.geometry.type === 'Point') {
    return [
      data.geometry.coordinates[0],
      data.geometry.coordinates[1],
      data.geometry.coordinates[0],
      data.geometry.coordinates[1],
    ];
  }
  if (coords) {
    coords.forEach(([xCoord, yCoord]) => {
      limits.xLow = Math.min(xCoord, limits.xLow);
      limits.xHigh = Math.max(xCoord, limits.xHigh);
      limits.yLow = Math.min(yCoord, limits.yLow);
      limits.yHigh = Math.max(yCoord, limits.yHigh);
    });
  }

  //We want to update the bounds with a buffer of like 5-10% if it is a line String
  if (data.geometry.type === 'LineString') {
    const buffer = 0.10;
    const height = limits.yHigh - limits.yLow;
    const width = limits.xHigh - limits.xLow;
    limits.xLow -= width * buffer;
    limits.xHigh += width * buffer;
    limits.yLow -= height * buffer;
    limits.yHigh += height * buffer;
  }
  //Now we create some bounds from our 4 points
  return [limits.xLow, limits.yLow, limits.xHigh, limits.yHigh];
}
/**
 * If the bounds should be updated based on the type of the new item and the size changes
 */
function updateBounds(
  oldBounds: RectBounds | undefined,
  newBounds: RectBounds,
  newData: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>,
) {
  //Polygons will always update the bounds or if there are no oldBounds
  if (newData.geometry.type === 'Polygon' || oldBounds === undefined) {
    return newBounds;
  }
  //If we have a line string we return the larger item
  if (newData.geometry.type === 'LineString' || newData.geometry.type === 'Point') {
    const outBounds = oldBounds;
    outBounds[0] = Math.min(oldBounds[0], newBounds[0]);
    outBounds[1] = Math.min(oldBounds[1], newBounds[1]);
    outBounds[2] = Math.max(oldBounds[2], newBounds[2]);
    outBounds[3] = Math.max(oldBounds[3], newBounds[3]);
    return outBounds;
  }
  return oldBounds;
}

export {
  boundToGeojson,
  findBounds,
  updateBounds,
  geojsonToBound,
  updateSubset,
  removePoint,
};
