// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import { isRootLocation } from '@girder/components/src/utils/locationHelpers';
import { GirderModel } from './lib/api/viame.service';

interface Location {
  type?: 'collections' | 'users' | 'root';
  _id?: string;
  _modelType?: string;
}

// [x1, y1, x2, y2] as (left, top), (bottom, right)
export type RectBounds = [number, number, number, number];

function getLocationFromRoute({ params }: { params: GirderModel }) {
  if (isRootLocation(params)) {
    return {
      type: params._modelType,
    };
  }
  if (params._modelType) {
    return params;
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

function findBounds(polygon: GeoJSON.Polygon): RectBounds {
  const coords = polygon.coordinates[0];
  const limits = {
    xLow: Infinity,
    xHigh: -Infinity,
    yLow: Infinity,
    yHigh: -Infinity,
  };
  console.log(coords);
  coords.forEach(([xCoord, yCoord]) => {
    console.log(`${xCoord} : ${yCoord}`);
    limits.xLow = Math.min(xCoord, limits.xLow);
    limits.xHigh = Math.max(xCoord, limits.xHigh);
    limits.yLow = Math.min(yCoord, limits.yLow);
    limits.yHigh = Math.max(yCoord, limits.yHigh);
  });
  //Now we create some bounds from our 4 points
  console.log(`${limits.xLow}, ${limits.yHigh}, ${limits.yLow}, ${limits.xHigh}`);
  return [limits.xLow, limits.yHigh, limits.xHigh, limits.yLow];
}

export {
  getLocationFromRoute,
  getPathFromLocation,
  geojsonToBound,
  boundToGeojson,
  findBounds,
};
