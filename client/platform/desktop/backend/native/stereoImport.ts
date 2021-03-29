import npath from 'path';
import fs from 'fs-extra';
import { shell } from 'electron';
import mime from 'mime-types';
import moment from 'moment';
import lockfile from 'proper-lockfile';
import {
  DatasetType, MultiTrackRecord, Pipelines, SaveDetectionsArgs,
  FrameImage, DatasetMetaMutable, TrainingConfigs, SaveAttributeArgs,
} from 'dive-common/apispec';
import * as viameSerializers from 'platform/desktop/backend/serializers/viame';

import {
  websafeImageTypes, websafeVideoTypes, otherImageTypes, otherVideoTypes,
  JsonMeta, Settings, JsonMetaCurrentVersion, DesktopMetadata, DesktopJobUpdater,
  ConvertMedia, RunTraining, ExportDatasetArgs, MediaImportPayload,
} from 'platform/desktop/constants';
import { cleanString, filterByGlob, makeid } from 'platform/desktop/sharedUtils';
import { Attribute, Attributes } from 'vue-media-annotator/use/useAttributes';
import processTrackAttributes from './attributeProcessor';

interface StereoImportMultiArgs {
    defaultDisplay: 'left' | 'right';
    leftFolder: string;
    rightFolder: string;
    calibrationFile?: string;
}

interface StereoImportMultiArgs {
    defaultDisplay: 'left' | 'right';
    keywordFolder: string;
    globPatternLeft: string;
    globPatternRight: string;
    calibrationFile?: string;
}

async function findImagesInFolder(path: string, glob?: string) {
  const images: string[] = [];
  let requiresTranscoding = false;
  const contents = await fs.readdir(path);

  contents.forEach((filename) => {
    const abspath = npath.join(path, filename);
    const mimetype = mime.lookup(abspath);
    if (glob === undefined || filterByGlob(glob, [filename]).length === 1) {
      if (
        mimetype && (websafeImageTypes.includes(mimetype)
            || otherImageTypes.includes(mimetype))
      ) {
        images.push(filename);
        if (otherImageTypes.includes(mimetype)) {
          requiresTranscoding = true;
        }
      }
    }
  });
  return {
    images,
    mediaConvetList: requiresTranscoding
      ? images.map((filename) => npath.join(path, filename))
      : [],
  };
}


/**
 * Begin a dataset import.
 */
async function beginStereoImportMulti(
  settings: Settings,
  args: StereoImportMultiArgs,
  checkMedia: (settings: Settings, path: string) => Promise<boolean>,
): Promise<MediaImportPayload> {
  let datasetType: DatasetType;

  const leftExists = fs.existsSync(args.leftFolder);
  if (!leftExists) {
    throw new Error(`file or directory not found: ${args.leftFolder}`);
  }
  const rightExists = fs.existsSync(args.rightFolder);
  if (!rightExists) {
    throw new Error(`file or directory not found: ${args.rightFolder}`);
  }

  let mainFolder = args.leftFolder;
  if (args.defaultDisplay === 'right') {
    mainFolder = args.rightFolder;
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
    stereoscopic: {
      leftImages: [],
      rightImages: [],
      calibration: args.calibrationFile,
      display: args.defaultDisplay,
    },
    name: dsName,
  };

  /* TODO: Look for an EXISTING meta.json file to override the above */

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
    throw new Error('Not support stereoscopic video at this time');
  } else if (datasetType === 'image-sequence') {
    const leftFound = await findImagesInFolder(args.leftFolder);
    if (leftFound.images.length === 0) {
      throw new Error(`no images found in ${args.leftFolder}`);
    }
    jsonMeta.originalImageFiles = leftFound.images;
    mediaConvertList = leftFound.mediaConvetList;
    const rightFound = await findImagesInFolder(args.rightFolder);
    if (rightFound.images.length === 0) {
      throw new Error(`no images found in ${args.rightFolder}`);
    }
    if (jsonMeta.stereoscopic) {
      jsonMeta.stereoscopic.leftImages = leftFound.images;
      jsonMeta.stereoscopic.rightImages = rightFound.images;
    }
    jsonMeta.originalImageFiles = leftFound.images.concat(rightFound.images);
    mediaConvertList = leftFound.mediaConvetList.concat(rightFound.mediaConvetList);
  } else {
    throw new Error('only video and image-sequence types are supported');
  }

  return {
    jsonMeta,
    globPattern: '',
    mediaConvertList,
  };
}
