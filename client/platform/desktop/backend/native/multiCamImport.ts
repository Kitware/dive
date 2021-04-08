import npath from 'path';
import fs from 'fs-extra';
import mime from 'mime-types';
import {
  DatasetType,
} from 'dive-common/apispec';

import {
  websafeImageTypes, otherImageTypes,
  JsonMeta, Settings, JsonMetaCurrentVersion,
  MediaImportPayload, MultiCamImportFolderArgs,
  MultiCamImportKeywordArgs,
  MultiCamImportArgs,
  websafeVideoTypes,
  otherVideoTypes,
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
  checkMedia: (settings: Settings, path: string) => Promise<boolean>,
): Promise<MediaImportPayload> {
  let datasetType: DatasetType;

  let mainFolder: string | undefined;
  const imageLists: Record<string, {
    basePath: string;
    filenames: string[];
    videoFile: string;
   }> = {};
  if (isFolderArgs(args)) {
    Object.entries(args.folderList).forEach(([key, folder]) => {
      const folderExists = fs.existsSync(folder);
      if (!folderExists) {
        throw new Error(`file or directory for ${key} not found: ${folder}`);
      }
      if (args.defaultDisplay === key) {
        mainFolder = folder;
      }
      imageLists[key] = { basePath: folder, filenames: [], videoFile: '' };
    });
  } else if (isKeywordArgs(args)) {
    const keywordExists = fs.existsSync(args.keywordFolder);
    if (!keywordExists) {
      throw new Error(`file or directory not found: ${args.keywordFolder}`);
    }
    mainFolder = args.keywordFolder;
    Object.entries(args.globList).forEach(([key]) => {
      imageLists[key] = { basePath: args.keywordFolder, filenames: [], videoFile: '' };
    });
  }
  if (mainFolder === undefined) {
    throw new Error('No main folder defined');
  }
  const stat = await fs.stat(mainFolder);
  if (stat.isDirectory()) {
    datasetType = 'image-sequence';
  } else if (stat.isFile()) {
    datasetType = 'video';
    //Reset the basePaths to folders instead of files
    Object.keys(imageLists).forEach((key) => {
      const newpath = npath.dirname(imageLists[key].basePath);
      if (typeof (newpath) === 'string') {
        imageLists[key].basePath = newpath;
      }
    });
  } else {
    throw new Error('Only regular files and directories are supported');
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
    originalBasePath: mainFolder,
    originalVideoFile: '',
    createdAt: (new Date()).toString(),
    originalImageFiles: [],
    transcodedVideoFile: '',
    transcodedImageFiles: [],
    name: dsName,
  };

  jsonMeta.multiCam = {
    imageLists,
    calibration: args.calibrationFile,
    display: args.defaultDisplay,
  };

  if (datasetType === 'video') {
    // get parent folder, since videos reference a file directly
    jsonMeta.originalBasePath = npath.dirname(mainFolder);
  }

  /* mediaConvertList is a list of absolute paths of media to convert */
  let mediaConvertList: string[] = [];
  /* Extract and validate media from import path */
  if (jsonMeta.type === 'video') {
    if (isFolderArgs(args)) {
      await asyncForEach(Object.entries(args.folderList),
        async ([key, video]: [string, string]) => {
          const mimetype = mime.lookup(video);
          if (key === args.defaultDisplay) {
            jsonMeta.originalVideoFile = npath.basename(video);
          }
          if (mimetype) {
            if (websafeImageTypes.includes(mimetype) || otherImageTypes.includes(mimetype)) {
              throw new Error('User chose image file for video import option');
            } else if (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype)) {
              const webSafeVideo = await checkMedia(settings, video);
              if (!webSafeVideo || otherVideoTypes.includes(mimetype)) {
                mediaConvertList.push(video);
              }
              if (jsonMeta.multiCam && jsonMeta.multiCam.imageLists[key] !== undefined) {
                jsonMeta.multiCam.imageLists[key].videoFile = npath.basename(video);
              }
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
  } else if (datasetType === 'image-sequence') {
    if (isFolderArgs(args)) {
      await asyncForEach(Object.entries(args.folderList),
        async ([key, folder]: [string, string]) => {
          const found = await findImagesInFolder(folder);
          if (found.images.length === 0) {
            throw new Error(`no images found in ${folder}`);
          }
          if (jsonMeta.multiCam && jsonMeta.multiCam.imageLists[key] !== undefined) {
            jsonMeta.multiCam.imageLists[key].filenames = found.images.map(
              (image) => image,
            );
            mediaConvertList = mediaConvertList.concat(found.mediaConvertList);
          }
        });
    } else if (isKeywordArgs(args)) {
      await asyncForEach(Object.entries(args.globList), async ([key, glob]: [string, string]) => {
        const found = await findImagesInFolder(args.keywordFolder, glob);
        if (jsonMeta.multiCam && jsonMeta.multiCam.imageLists[key] !== undefined) {
          jsonMeta.multiCam.imageLists[key].filenames = found.images.map(
            (image) => image,
          );
          mediaConvertList = mediaConvertList.concat(found.mediaConvertList);
        }
      });
    }
  } else {
    throw new Error('only video and image-sequence types are supported');
  }


  return {
    jsonMeta,
    globPattern: '',
    mediaConvertList,
  };
}

export default beginMultiCamImport;
