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
  JsonMeta, Settings, JsonMetaCurrentVersion,
  CheckMediaResults,
  MediaImportPayload,
} from 'platform/desktop/constants';
import { cleanString, makeid } from 'platform/desktop/sharedUtils';
import { findImagesInFolder } from './common';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isFolderArgs(s: any): s is MultiCamImportFolderArgs {
  if (s.folderList && s.defaultDisplay) {
    return true;
  }
  return false;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isKeywordArgs(s: any): s is MultiCamImportKeywordArgs {
  if (s.globList && s.defaultDisplay) {
    return true;
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function asyncForEach(array: any[], callback: Function) {
  for (let index = 0; index < array.length; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await callback(array[index], index, array);
  }
}
/**
 * Begin a dataset import.
 */
async function beginMultiCamImport(
  settings: Settings,
  args: MultiCamImportArgs,
  checkMedia: (settings: Settings, path: string) => Promise<CheckMediaResults>,
): Promise<MediaImportPayload> {
  const datasetType: DatasetType = MultiType;

  let mainFolder: string | undefined;
  const cameras: Record<string, {
    originalBasePath: string;
    originalImageFiles: string[];
    originalVideoFile: string;
    transcodedImageFiles: string[];
    transcodedVideoFile: string;
    type: 'image-sequence' | 'video';
   }> = {};
  let multiCamTrackFiles: null | Record<string, string> = {};
  let trackFileCount = 0;
  if (isFolderArgs(args)) {
    Object.entries(args.folderList).forEach(([key, item]) => {
      const folderExists = fs.existsSync(item.folder);
      if (!folderExists) {
        throw new Error(`file or directory for ${key} not found: ${item.folder}`);
      }
      cameras[key] = {
        type: args.type,
        originalBasePath: item.folder,
        originalImageFiles: [],
        originalVideoFile: '',
        transcodedImageFiles: [],
        transcodedVideoFile: '',
      };
      if (args.type === 'video') {
        // Reset the base path to a folder for videos
        cameras[key].originalBasePath = npath.dirname(cameras[key].originalBasePath);
      }
      if (args.defaultDisplay === key) {
        mainFolder = cameras[key].originalBasePath;
      }
    });
  } else if (isKeywordArgs(args)) {
    const keywordExists = fs.existsSync(args.keywordFolder);
    if (!keywordExists) {
      throw new Error(`file or directory not found: ${args.keywordFolder}`);
    }
    mainFolder = args.keywordFolder;
    Object.entries(args.globList).forEach(([key]) => {
      //All glob pattern matches are image-sequence files
      cameras[key] = {
        type: args.type,
        originalBasePath: args.keywordFolder,
        originalImageFiles: [],
        originalVideoFile: '',
        transcodedImageFiles: [],
        transcodedVideoFile: '',
      };
    });
  }
  if (mainFolder === undefined) {
    throw new Error('No main folder defined');
  }

  const dsName = npath.dirname(mainFolder).split(npath.sep).pop();
  if (!dsName) {
    throw new Error(`no parent folder for ${args.defaultDisplay} folder`);
  }
  const dsId = `${cleanString(dsName).substr(0, 20)}_${makeid(10)}`;

  const jsonMeta: JsonMeta = {
    version: JsonMetaCurrentVersion,
    type: datasetType,
    id: dsId,
    fps: 5, // TODO
    originalFps: 5,
    originalBasePath: mainFolder,
    originalVideoFile: '',
    createdAt: (new Date()).toString(),
    originalImageFiles: [],
    transcodedVideoFile: '',
    transcodedImageFiles: [],
    name: dsName,
    multiCam: null,
    subType: null,
  };

  jsonMeta.multiCam = {
    cameras,
    calibration: args.calibrationFile,
    defaultDisplay: args.defaultDisplay,
  };
  /* mediaConvertList is a list of absolute paths of media to convert */
  let mediaConvertList: string[] = [];
  /* Extract and validate media from import path */
  if (args.type === 'video') {
    if (isFolderArgs(args)) {
      await asyncForEach(Object.entries(args.folderList),
        async ([key, item]: [string, {folder: string; trackFile: string}]) => {
          if (item.trackFile && multiCamTrackFiles) {
            multiCamTrackFiles[key] = item.trackFile;
            trackFileCount += 1;
          }
          const video = item.folder;
          const mimetype = mime.lookup(video);
          if (key === args.defaultDisplay) {
            jsonMeta.originalVideoFile = npath.basename(video);
          }
          if (mimetype) {
            if (websafeImageTypes.includes(mimetype) || otherImageTypes.includes(mimetype)) {
              throw new Error('User chose image file for video import option');
            } else if (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype)) {
              const checkMediaResult = await checkMedia(settings, video);
              if (!checkMediaResult.websafe || otherVideoTypes.includes(mimetype)) {
                mediaConvertList.push(video);
              }
              if (jsonMeta.multiCam && jsonMeta.multiCam.cameras[key] !== undefined) {
                jsonMeta.multiCam.cameras[key].originalVideoFile = npath.basename(video);
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
        });
    } else if (isKeywordArgs(args)) {
      throw new Error('glob pattern matching is not supported for multi-cam videos');
    }
  } else if (args.type === 'image-sequence') {
    if (isFolderArgs(args)) {
      await asyncForEach(Object.entries(args.folderList),
        async ([key, item]: [string, {folder: string; trackFile: string}]) => {
          if (item.trackFile && multiCamTrackFiles) {
            multiCamTrackFiles[key] = item.trackFile;
            trackFileCount += 1;
          }
          const found = await findImagesInFolder(item.folder);
          if (found.images.length === 0) {
            throw new Error(`no images found in ${item.folder}`);
          }
          if (jsonMeta.multiCam && jsonMeta.multiCam.cameras[key] !== undefined) {
            jsonMeta.multiCam.cameras[key].originalImageFiles = found.images.map(
              (image) => image,
            );
            mediaConvertList = mediaConvertList.concat(found.mediaConvertList);
          }
        });
    } else if (isKeywordArgs(args)) {
      await asyncForEach(Object.entries(args.globList),
        async ([key, item]: [string, {glob: string; trackFile: string}]) => {
          const found = await findImagesInFolder(args.keywordFolder, item.glob);
          if (jsonMeta.multiCam && jsonMeta.multiCam.cameras[key] !== undefined) {
            jsonMeta.multiCam.cameras[key].originalImageFiles = found.images.map(
              (image) => image,
            );
            mediaConvertList = mediaConvertList.concat(found.mediaConvertList);
          }
        });
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
  if (trackFileCount === 0) {
    multiCamTrackFiles = null;
  }

  return {
    jsonMeta,
    globPattern: '',
    mediaConvertList,
    trackFileAbsPath: '',
    multiCamTrackFiles,
  };
}

export default beginMultiCamImport;
