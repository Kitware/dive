import { AxiosError } from 'axios';
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import { isRootLocation } from '@girder/components/src/utils/locationHelpers';
import { getFolder } from 'viame-web-common/api/girder.service';
import { GirderModel } from 'viame-web-common/api/viame.service';

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
