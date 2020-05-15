function getResponseError(error) {
  const { response } = error;
  if (response && response.data && response.data.message) {
    return response.data.message;
  }
  return error;
}

export {
  // eslint-disable-next-line import/prefer-default-export
  getResponseError,
};
