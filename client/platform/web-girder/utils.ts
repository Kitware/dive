import { AxiosError } from 'axios';
import { isRootLocation, GirderModel } from '@girder/components/src';
import { getFolder } from './api/girder.service';

interface Location {
  type?: 'collections' | 'users' | 'root';
  _id?: string;
  _modelType?: string;
}

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

function getResponseError(error: AxiosError): string | AxiosError {
  const { response } = error;
  return response?.data?.message || error;
}


export {
  getLocationFromRoute,
  getPathFromLocation,
  getResponseError,
};
