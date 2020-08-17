// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import { isRootLocation } from '@girder/components/src/utils/locationHelpers';

import { getFolder } from '@/lib/api/girder.service';
import { GirderModel } from '@/lib/api/viame.service';
import geojs from 'geojs';

interface Location {
  type?: 'collections' | 'users' | 'root';
  _id?: string;
  _modelType?: string;
}

// [x1, y1, x2, y2] as (left, top), (bottom, right)
export type RectBounds = [number, number, number, number];

async function getLocationFromRoute({ params }: { params: GirderModel }) {
  if (isRootLocation(params)) {
    return {
      type: params._modelType,
    };
  }
  if (params._modelType === 'user') {
    return params;
  }
  if (params._modelType === 'folder') {
    return getFolder(params._id);
  }
  return null;
}

function getPathFromLocation(location: Location) {
  if (!location) {
    return '/';
  }
  if (location.type && !location._modelType) {
    return `/${location.type}`;
  }
  return `/${location._modelType}${
    location._id ? `/${location._id}` : ''
  }`;
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
function removePoint(data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString>, index: number) {
  if (data.geometry.type === 'Polygon') {
    if (data.geometry.coordinates[0].length > 3) {
      data.geometry.coordinates[0].splice(index, 1);
      return true;
    }
    console.warn('Polygons must have at least 3 points');
    return false;
  } if (data.geometry.coordinates.length > 2) { //Handling a Line
    data.geometry.coordinates.splice(index, 1);
    return true;
  }
  console.warn('Lines must have at least 2 points');
  return false;
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
  if (coords) {
    coords.forEach(([xCoord, yCoord]) => {
      limits.xLow = Math.min(xCoord, limits.xLow);
      limits.xHigh = Math.max(xCoord, limits.xHigh);
      limits.yLow = Math.min(yCoord, limits.yLow);
      limits.yHigh = Math.max(yCoord, limits.yHigh);
    });
  }
  //Now we create some bounds from our 4 points
  return [limits.xLow, limits.yLow, limits.xHigh, limits.yHigh];
}

export {
  getLocationFromRoute,
  getPathFromLocation,
  geojsonToBound,
  boundToGeojson,
  findBounds,
  removePoint,
};
