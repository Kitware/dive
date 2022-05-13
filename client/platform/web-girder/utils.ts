import {
  calibrationFileTypes, inputAnnotationFileTypes, inputAnnotationTypes,
  otherImageTypes, otherVideoTypes, websafeImageTypes, websafeVideoTypes, zipFileTypes,
} from 'dive-common/constants';
import { DatasetType } from 'dive-common/apispec';
import type { LocationType, RootlessLocationType } from 'platform/web-girder/store/types';
import { Route } from 'vue-router';

/**
 * If the current route is representable by a LocationType, return it.
 * _modelType comes from the router spec and must be converted into LocationType
 */
function getLocationFromRoute(route: Route): LocationType | null {
  const { params } = route;
  if (['root', 'collections', 'users'].indexOf(params.routeType) >= 0) {
    return { type: params.routeType } as LocationType;
  }
  if (['user', 'folder', 'collection'].indexOf(params.routeType) >= 0) {
    return {
      _modelType: params.routeType,
      _id: params.routeId,
    } as RootlessLocationType;
  }
  return null;
}

function getRouteFromLocation(location: LocationType): string {
  if (!location) {
    return '/';
  }
  if ('type' in location && !('_modelType' in location)) {
    return `/${location.type}`;
  }
  return `/${location._modelType}/${location._id}`;
}

async function openFromDisk(datasetType: DatasetType | 'calibration' | 'annotation' | 'zip'):
Promise<{ canceled: boolean; filePaths: string[]; fileList?: File[]}> {
  const input: HTMLInputElement = document.createElement('input');
  input.type = 'file';
  const baseTypes: string[] = inputAnnotationFileTypes.map((item) => `.${item}`);
  if (!['calbiration', 'annotation', 'zip'].includes(datasetType)) {
    input.multiple = true;
  }
  if (datasetType === 'image-sequence') {
    input.accept = baseTypes.concat(websafeImageTypes).concat(otherImageTypes).join(',');
  } else if (datasetType === 'video') {
    input.accept = baseTypes.concat(websafeVideoTypes).concat(otherVideoTypes).join(',');
  } else if (datasetType === 'calibration') {
    input.accept = calibrationFileTypes.map((item) => `.${item}`).join(',');
  } else if (datasetType === 'annotation') {
    input.accept = inputAnnotationTypes
      .concat(inputAnnotationFileTypes.map((item) => `.${item}`)).join(',');
  } else if (datasetType === 'zip') {
    input.accept = zipFileTypes.map((item) => `.${item}`).join(',');
  }

  return new Promise(((resolve, reject) => {
    input.onchange = (event) => {
      if (event) {
        const { files } = event.target as HTMLInputElement;
        if (files) {
          const fileList = Array.from(files);
          if (datasetType === 'annotation') {
            if (!fileList.every((item) => inputAnnotationTypes.includes(item.type))) {
              reject(new Error('File Types did not match JSON or CSV'));
            }
          }
          const response = {
            canceled: !files.length,
            fileList,
            filePaths: fileList.map((item) => item.name),
          };
          return resolve(response);
        }
      }
      return resolve({
        canceled: true,
        filePaths: [],
      });
    };
    input.click();
  }));
}


export {
  getLocationFromRoute,
  getRouteFromLocation,
  openFromDisk,
};
