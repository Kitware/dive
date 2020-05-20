function getLocationFromRoute(route) {
  const { _modelType, _id } = route.params;
  if (_modelType) {
    return { _modelType, _id };
  }
  return null;
}

// TODO: document
function getPathFromLocation(location) {
  if (!location) {
    return '/';
  }
  return `/${location._modelType || location.type}${
    location._id ? `/${location._id}` : ''
  }`;
}

// TODO: document
function geojsonToBound(geojson) {
  const coords = geojson.coordinates[0];
  return [coords[0][0], coords[1][0], coords[0][1], coords[2][1]];
}

// TODO: document
function geojsonToBound2(geojson) {
  const coords = geojson.coordinates[0];
  return [coords[0][0], coords[2][0], coords[1][1], coords[0][1]];
}

// TODO: document
function boundToGeojson(bounds) {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [bounds[0], bounds[2]],
        [bounds[1], bounds[2]],
        [bounds[1], bounds[3]],
        [bounds[0], bounds[3]],
        [bounds[0], bounds[2]],
      ],
    ],
  };
}

function stringNumberNullValidator(prop) {
  return ['string', 'number'].indexOf(typeof prop) >= 0 || prop === null;
}

export {
  getLocationFromRoute,
  getPathFromLocation,
  geojsonToBound,
  geojsonToBound2,
  boundToGeojson,
  stringNumberNullValidator,
};
