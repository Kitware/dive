import { AxiosError } from 'axios';
import { ref } from '@vue/composition-api';
import { isRootLocation, GirderModel } from '@girder/components/src';

interface Location {
  type?: 'collections' | 'users' | 'root';
  _id?: string;
  _modelType?: string;
}

function getLocationFromRoute({ params }: { params: GirderModel }) {
  if (isRootLocation(params)) {
    return {
      type: params._modelType,
    };
  }
  if (params._modelType === 'user') {
    return params;
  }
  if (params._modelType === 'folder') {
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

function getResponseError(error: AxiosError): string {
  const { response } = error;
  return response?.data?.message || error;
}

function withRestError(callable: () => Promise<unknown>) {
  const error = ref('');

  function wrapped() {
    error.value = '';
    return callable().catch((err) => {
      error.value = getResponseError(err);
      throw err;
    });
  }
  return { func: wrapped, error };
}


export {
  getLocationFromRoute,
  getPathFromLocation,
  getResponseError,
  withRestError,
};
