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


function geojsonToBound({ coordinates }: {
  coordinates: number[][][]; // Array of [x,y] points of vertexes of shapes
}): [number, number, number, number] {
  const coords = coordinates[0];
  // return [x1, y1, x2, y2] of the first shape in the shape arr.
  return [coords[0][0], coords[1][1], coords[1][0], coords[2][1]];
}

function boundToGeojson(bounds: [number, number, number, number]) {
  /* return clockwise 5 point rectangle from [x1, y1, x2, y2]
   * beginning with (x1, y1)
   */
  return {
    type: 'Polygon',
    coordinates: [
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[1]],
        [bounds[2], bounds[3]],
        [bounds[0], bounds[3]],
        [bounds[0], bounds[1]],
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
