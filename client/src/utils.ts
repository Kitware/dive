import { GirderModel } from './lib/api/viame.service';

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
function geojsonToBound({ coordinates }: {
  coordinates: number[][][]; // Array of [x,y] points of vertexes of shapes
}) {
  console.log(coordinates);
  const coords = coordinates[0];
  // return [x1, y1, x2, y2] of the first shape in the shape arr.
  return [coords[1][0], coords[1][1], coords[3][0], coords[3][1]];
}

function boundToGeojson(bounds: [number, number, number, number]) {
  /* return clockwise 5 point rectangle from [x1, y1, x2, y2]
   * beginning with (x1, y2) (bottom left) because that's what GeoJS
   * likes for some reason.
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

export {
  getLocationFromRoute,
  getPathFromLocation,
  geojsonToBound,
  boundToGeojson,
};
