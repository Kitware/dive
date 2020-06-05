import { Polygon } from 'geojs';
import { GirderModel } from './lib/api/viame.service';

// [x1, y1, x2, y2] as (left, top), (bottom, right)
export type RectBounds = [number, number, number, number];

function getLocationFromRoute({ params }: { params: GirderModel }) {
  const { _modelType, _id } = params;
  if (_modelType) {
    return { _modelType, _id };
  }
  return null;
}

// TODO: document
function getPathFromLocation(location: GirderModel) {
  if (!location) {
    return '/';
  }
  return `/${location._modelType}${
    location._id ? `/${location._id}` : ''
  }`;
}

/* beginning at bottom left, rectangle is defined clockwise */
function geojsonToBound(geojson: GeoJSON.Polygon): RectBounds {
  const coords = geojson.coordinates[0];
  return [coords[1][0], coords[1][1], coords[3][0], coords[3][1]];
}

function boundToGeojson(bounds: RectBounds): Polygon {
  /* return clockwise 5 point rectangle beginning with (x1, y2) (bottom left)
   * because that's what GeoJS likes
   */
  return {
    type: 'Polygon',
    coordinates: [
      [bounds[0], bounds[3]],
      [bounds[0], bounds[1]],
      [bounds[2], bounds[1]],
      [bounds[2], bounds[3]],
      [bounds[0], bounds[3]],
    ],
  };
}

export {
  getLocationFromRoute,
  getPathFromLocation,
  geojsonToBound,
  boundToGeojson,
};
