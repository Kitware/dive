import { UploadManager, type Location } from '@girder/components';
import {
  calibrationFileTypes, inputAnnotationFileTypes, inputAnnotationTypes,
  getLargeImageAllowedExtensions, getLargeImageFileAccept,
  otherImageTypes, otherVideoTypes, websafeImageTypes, websafeVideoTypes, zipFileTypes,
} from 'dive-common/constants';
import { DatasetType } from 'dive-common/apispec';
import type { LocationType, RootlessLocationType } from 'platform/web-girder/store/types';
import { Route } from 'vue-router';
import { AxiosInstance } from 'axios';

/**
 * If the current route is representable by a LocationType, return it.
 * _modelType comes from the router spec and must be converted into LocationType
 */
function getLocationFromRoute(route: Route): LocationType | null {
  const { params } = route;
  const routeType = Array.isArray(params.routeType)
    ? params.routeType[0]
    : params.routeType;
  if (!routeType) {
    return null;
  }
  if (['root', 'collections', 'users'].indexOf(routeType) >= 0) {
    return { type: routeType } as LocationType;
  }
  if (['user', 'folder', 'collection'].indexOf(routeType) >= 0) {
    const routeId = Array.isArray(params.routeId)
      ? params.routeId[0]
      : params.routeId;
    return {
      _modelType: routeType,
      _id: routeId,
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

async function openFromDisk(
  datasetType: DatasetType | 'calibration' | 'annotation' | 'text' | 'zip',
  directory = false,
): Promise<{ canceled: boolean; filePaths: string[]; fileList?: File[]; root?: string }> {
  const input: HTMLInputElement = document.createElement('input');
  input.type = 'file';
  const baseTypes: string[] = inputAnnotationFileTypes.map((item) => `.${item}`);
  if (!['calibration', 'annotation', 'zip'].includes(datasetType)) {
    input.multiple = true;
  }
  if (directory && (datasetType === 'image-sequence' || datasetType === 'video')) {
    input.setAttribute('webkitdirectory', '');
    input.multiple = true;
  }
  if (datasetType === 'image-sequence' && !directory) {
    input.accept = baseTypes.concat(websafeImageTypes).concat(otherImageTypes).join(',');
  } else if (directory && (datasetType === 'image-sequence' || datasetType === 'video')) {
    input.accept = '';
  } else if (datasetType === 'video') {
    input.accept = baseTypes.concat(websafeVideoTypes).concat(otherVideoTypes).join(',');
  } else if (datasetType === 'large-image') {
    input.accept = getLargeImageFileAccept();
  } else if (datasetType === 'calibration') {
    input.accept = calibrationFileTypes.map((item) => `.${item}`).join(',');
  } else if (datasetType === 'annotation') {
    input.accept = inputAnnotationTypes
      .concat(inputAnnotationFileTypes.map((item) => `.${item}`)).join(',');
  } else if (datasetType === 'zip') {
    input.accept = zipFileTypes.map((item) => `.${item}`).join(',');
  } else if (datasetType === 'text') {
    input.accept = '.txt,.text';
    input.multiple = false;
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
          } else if (datasetType === 'large-image') {
            const allowed = new Set(getLargeImageAllowedExtensions().map((ext) => ext.toLowerCase()));
            if (!fileList.every((item) => {
              const ext = item.name.split('.').pop()?.toLowerCase();
              return ext && allowed.has(ext);
            })) {
              reject(new Error('File types did not match tiled image formats'));
            }
          }
          const filePaths = fileList.map(
            (item) => item.webkitRelativePath || item.name,
          );
          let root: string | undefined;
          if (directory && filePaths.length) {
            const parts = filePaths.map((p) => p.split('/').filter(Boolean));
            if (parts[0].length > 1) {
              const prefix: string[] = [];
              const depth = Math.min(...parts.map((p) => p.length - 1));
              for (let i = 0; i < depth; i += 1) {
                const segment = parts[0][i];
                if (parts.every((p) => p[i] === segment)) {
                  prefix.push(segment);
                } else {
                  break;
                }
              }
              root = prefix.join('/');
            }
          }
          const response = {
            canceled: !files.length,
            fileList,
            filePaths,
            root,
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

interface UploadOptions {
  $rest: AxiosInstance;
  parent: Location;
  progress?: () => null;
  params?: Record<string, unknown>;
  chunkLen?: number;
}

class GirderUploadManager extends UploadManager {
  constructor(file: File, options: UploadOptions = {} as UploadOptions) {
    const envChunkSize = parseInt(process.env.VUE_APP_UPLOAD_CHUNK_SIZE || '', 10);
    const chunkSize = Number.isFinite(envChunkSize) ? envChunkSize : 64 * 1024 * 1024;
    const finalOptions: UploadOptions = {
      ...options,
      chunkLen: options.chunkLen ?? chunkSize,
    };
    super(file, finalOptions);
  }
}

export {
  getLocationFromRoute,
  getRouteFromLocation,
  openFromDisk,
  GirderUploadManager,
};
