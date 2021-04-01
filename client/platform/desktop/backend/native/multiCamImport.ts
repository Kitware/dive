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
} from 'platform/desktop/constants';
import { cleanString, makeid } from 'platform/desktop/sharedUtils';
import { findImagesInFolder } from './common';


function isFolderArgs(s: any): s is MultiCamImportFolderArgs {
  if (s.folderList && s.defaultDisplay) {
    return true;
  }
  return false;
}
function isKeywordArgs(s: any): s is MultiCamImportKeywordArgs {
  if (s.globList && s.defaultDisplay) {
    return true;
  }
  return false;
}

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
  args: MultiCamImportKeywordArgs | MultiCamImportFolderArgs,
  checkMedia: (settings: Settings, path: string) => Promise<boolean>,
): Promise<MediaImportPayload> {
  let datasetType: DatasetType;

  let mainFolder: string | undefined;
  const imageLists: Record<string, string[]> = {};
  if (isFolderArgs(args)) {
    Object.entries(args.folderList).forEach(([key, folder]) => {
      const folderExists = fs.existsSync(folder);
      if (!folderExists) {
        throw new Error(`file or directory for ${key} not found: ${folder}`);
      }
      if (args.defaultDisplay === key) {
        mainFolder = folder;
      }
      imageLists[key] = [];
    });
  } else if (isKeywordArgs(args)) {
    const keywordExists = fs.existsSync(args.keywordFolder);
    if (!keywordExists) {
      throw new Error(`file or directory not found: ${args.keywordFolder}`);
    }
    mainFolder = args.keywordFolder;
    Object.entries(args.globList).forEach(([key]) => {
      imageLists[key] = [];
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
    // TODO Stereo Video Support
    /*
    jsonMeta.originalVideoFile = npath.basename(mainFolder);
    const mimetype = mime.lookup(mainFolder);
    if (mimetype) {
      if (websafeImageTypes.includes(mimetype) || otherImageTypes.includes(mimetype)) {
        throw new Error('User chose image file for video import option');
      } else if (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype)) {
        const webSafeVideo = await checkMedia(settings, path);
        if (!webSafeVideo || otherVideoTypes.includes(mimetype)) {
          mediaConvertList.push(path);
        }
      } else {
        throw new Error(`unsupported MIME type for video ${mimetype}`);
      }
    } else {
      throw new Error(`could not determine video MIME type for ${path}`);
    }
    */
    throw new Error('No support stereoscopic video at this time');
  } else if (datasetType === 'image-sequence') {
    if (isFolderArgs(args)) {
      await asyncForEach(Object.entries(args.folderList),
        async ([key, folder]: [string, string]) => {
          const found = await findImagesInFolder(folder);
          if (found.images.length === 0) {
            throw new Error(`no images found in ${folder}`);
          }
          if (jsonMeta.multiCam && jsonMeta.multiCam.imageLists[key] !== undefined) {
            jsonMeta.multiCam.imageLists[key] = found.images.map(
              (image) => npath.join(folder, image),
            );
            jsonMeta.originalImageFiles = jsonMeta.originalImageFiles.concat(found.images);
            mediaConvertList = mediaConvertList.concat(found.mediaConvetList);
          }
        });
    } else if (isKeywordArgs(args)) {
      await asyncForEach(Object.entries(args.globList), async ([key, glob]: [string, string]) => {
        const found = await findImagesInFolder(args.keywordFolder, glob);
        if (jsonMeta.multiCam && jsonMeta.multiCam.imageLists[key] !== undefined) {
          jsonMeta.multiCam.imageLists[key] = found.images.map(
            (image) => npath.join(args.keywordFolder, image),
          );
          jsonMeta.originalImageFiles = jsonMeta.originalImageFiles.concat(found.images);
          mediaConvertList = mediaConvertList.concat(found.mediaConvetList);
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

function writeMultiCamPipelineInputs(jobWorkDir: string, meta: JsonMeta) {
  if (meta.type === 'video') {
    // TODO Support stereo video
  } else if (meta.type === 'image-sequence') {
    if (meta.multiCam && meta.multiCam.imageLists) {
      let i = 0;
      Object.entries(meta.multiCam.imageLists).forEach(([key, list]) => {
        const inputFile = fs.createWriteStream(npath.join(jobWorkDir, `cam${i}_images.txt`));
        list.forEach((image) => inputFile.write(`${image}\n`));
        inputFile.end();
        i += 1;
      });
    }
  }
}

export default { beginMultiCamImport, writeMultiCamPipelineInputs };
