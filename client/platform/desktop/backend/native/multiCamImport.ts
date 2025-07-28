import npath from 'path';
import fs from 'fs-extra';
import mime from 'mime-types';
import {
  DatasetType,
  MultiCamImportFolderArgs,
  MultiCamImportKeywordArgs,
  MultiCamImportArgs,
} from 'dive-common/apispec';
import {
  websafeImageTypes, websafeVideoTypes, otherImageTypes, otherVideoTypes, MultiType,
} from 'dive-common/constants';
import {
  JsonMeta, JsonMetaCurrentVersion,
  DesktopMediaImportResponse,
  Camera,
} from 'platform/desktop/constants';
import { checkMedia } from 'platform/desktop/backend/native/mediaJobs';
import { findImagesInFolder } from './common';

function isFolderArgs(s: MultiCamImportArgs): s is MultiCamImportFolderArgs {
  if ('sourceList' in s && 'defaultDisplay' in s) {
    return true;
  }
  return false;
}

function isKeywordArgs(s: MultiCamImportArgs): s is MultiCamImportKeywordArgs {
  if ('globList' in s && 'defaultDisplay' in s) {
    return true;
  }
  return false;
}

async function asyncForEach<T>(array: T[], callback: (item: T, index: number, arr: T[]) => void) {
  for (let index = 0; index < array.length; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await callback(array[index], index, array);
  }
}
/**
 * Begin a dataset import.
 */
async function beginMultiCamImport(args: MultiCamImportArgs): Promise<DesktopMediaImportResponse> {
  const datasetType: DatasetType = MultiType;
  const cameras: Record<string, Camera> = {};
  const multiCamTrackFiles: Record<string, string> = {};
  let trackFileCount = 0;
  if (isFolderArgs(args)) {
    if (!(args.defaultDisplay in args.sourceList)) {
      throw new Error(`${args.defaultDisplay} is not a camera name`);
    }
    Object.entries(args.sourceList).forEach(([key, item]) => {
      const pathExists = fs.existsSync(item.sourcePath);
      if (!pathExists) {
        throw new Error(`file or directory for ${key} not found: ${item.sourcePath}`);
      }
      cameras[key] = {
        type: args.type,
        originalBasePath: item.sourcePath,
        originalImageFiles: [],
        originalVideoFile: '',
        transcodedImageFiles: [],
        transcodedVideoFile: '',
      };
      if (args.type === 'video') {
        // Reset the base path to a folder for videos
        cameras[key].originalBasePath = npath.dirname(cameras[key].originalBasePath);
      }
    });
  } else if (isKeywordArgs(args)) {
    if (!(args.defaultDisplay in args.globList)) {
      throw new Error(`${args.defaultDisplay} is not a camera name`);
    }
    const keywordExists = fs.existsSync(args.sourcePath);
    if (!keywordExists) {
      throw new Error(`file or directory not found: ${args.sourcePath}`);
    }
    Object.entries(args.globList).forEach(([key]) => {
      //All glob pattern matches are image-sequence files
      cameras[key] = {
        type: args.type,
        originalBasePath: args.sourcePath,
        originalImageFiles: [],
        originalVideoFile: '',
        transcodedImageFiles: [],
        transcodedVideoFile: '',
      };
    });
  }

  const jsonMeta: JsonMeta = {
    version: JsonMetaCurrentVersion,
    type: datasetType,
    id: '', // will be assigned on finalize
    fps: 5,
    originalFps: 5,
    originalBasePath: '',
    originalVideoFile: '',
    createdAt: (new Date()).toString(),
    originalImageFiles: [],
    transcodedVideoFile: '',
    transcodedImageFiles: [],
    name: 'Multi-camera data',
    multiCam: {
      cameras,
      calibration: args.calibrationFile,
      defaultDisplay: args.defaultDisplay,
    },
    subType: null,
  };

  /* mediaConvertList is a list of absolute paths of media to convert */
  let mediaConvertList: string[] = [];
  /* Extract and validate media from import path */
  if (args.type === 'video') {
    if (isFolderArgs(args)) {
      await asyncForEach(
        Object.entries(args.sourceList),
        async ([cameraName, item]) => {
          if (item.trackFile) {
            multiCamTrackFiles[cameraName] = item.trackFile;
            trackFileCount += 1;
          }
          const video = item.sourcePath;
          const mimetype = mime.lookup(video);
          if (cameraName === args.defaultDisplay) {
            jsonMeta.originalVideoFile = npath.basename(video);
          }
          if (mimetype) {
            if (websafeImageTypes.includes(mimetype) || otherImageTypes.includes(mimetype)) {
              throw new Error('User chose image file for video import option');
            } else if (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype)) {
              const checkMediaResult = await checkMedia(video);
              if (!checkMediaResult.websafe || otherVideoTypes.includes(mimetype)) {
                mediaConvertList.push(video);
              }
              if (jsonMeta.multiCam && jsonMeta.multiCam.cameras[cameraName] !== undefined) {
                jsonMeta.multiCam.cameras[cameraName].originalVideoFile = npath.basename(video);
              }
              const newAnnotationFps = Math.floor(
                Math.min(jsonMeta.fps, checkMediaResult.originalFps),
              );
              if (newAnnotationFps <= 0) {
                throw new Error('fps < 1 unsupported');
              }
              jsonMeta.originalFps = checkMediaResult.originalFps;
              jsonMeta.fps = newAnnotationFps;
            } else {
              throw new Error(`unsupported MIME type for video ${mimetype}`);
            }
          } else {
            throw new Error(`could not determine video MIME type for ${video}`);
          }
        },
      );
    } else if (isKeywordArgs(args)) {
      throw new Error('glob pattern matching is not supported for multi-cam videos');
    }
  } else if (args.type === 'image-sequence') {
    if (isFolderArgs(args)) {
      await asyncForEach(
        Object.entries(args.sourceList),
        async ([cameraName, item]) => {
          if (item.trackFile) {
            multiCamTrackFiles[cameraName] = item.trackFile;
            trackFileCount += 1;
          }
          const found = await findImagesInFolder(item.sourcePath);
          if (found.imagePaths.length === 0) {
            throw new Error(`no images found in ${item.sourcePath}`);
          }
          mediaConvertList = mediaConvertList.concat(found.mediaConvertList);
          if (found.source === 'directory') {
            cameras[cameraName].originalImageFiles = found.imageNames;
          } else if (found.source === 'image-list') {
            cameras[cameraName].originalImageFiles = found.imagePaths;
            cameras[cameraName].imageListPath = jsonMeta.originalBasePath;
            cameras[cameraName].originalBasePath = '';
          }
        },
      );
    } else if (isKeywordArgs(args)) {
      jsonMeta.originalBasePath = args.sourcePath;
      await asyncForEach(
        Object.entries(args.globList),
        async ([cameraName, item]) => {
          const found = await findImagesInFolder(args.sourcePath, item.glob);
          mediaConvertList = mediaConvertList.concat(found.mediaConvertList);
          if (found.source === 'directory') {
            cameras[cameraName].originalImageFiles = found.imageNames;
          } else if (found.source === 'image-list') {
            cameras[cameraName].originalImageFiles = found.imagePaths;
            cameras[cameraName].imageListPath = jsonMeta.originalBasePath;
            cameras[cameraName].originalBasePath = '';
          }
        },
      );
    }
  } else {
    throw new Error('only video and image-sequence types are supported');
  }

  if (jsonMeta.multiCam?.cameras && jsonMeta.multiCam.cameras.left
    && jsonMeta.multiCam.cameras.right && jsonMeta.multiCam.calibration) {
    jsonMeta.subType = 'stereo';
  } else if (jsonMeta.multiCam) {
    jsonMeta.subType = 'multicam';
  }

  if (mediaConvertList.length && Object.values(cameras).some((cam) => cam.imageListPath)) {
    throw new Error('Transcoding is not supported when an image list is used');
  }

  return {
    jsonMeta,
    globPattern: '',
    mediaConvertList,
    trackFileAbsPath: '',
    forceMediaTranscode: false,
    multiCamTrackFiles: trackFileCount === 0 ? null : multiCamTrackFiles,
  };
}

export default beginMultiCamImport;
