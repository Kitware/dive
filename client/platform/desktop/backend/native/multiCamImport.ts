import npath from 'path';
import fs from 'fs-extra';
import mime from 'mime-types';
import {
  DatasetType,
  DatasetMetaMutable,
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
import { readTransformMatrix } from 'vue-media-annotator/alignedView/alignedView';
import { findImagesInFolder } from './common';
import {
  CameraCorrespondences,
  CameraHomographies,
  CameraTransformTypes,
  fromRegistrationPairs,
  mergeRegistrationSources,
  RegistrationSource,
} from './cameraRegistration';

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

  // Per-camera transform/registration files seed the dataset's saved camera
  // registration -- the same single registration the in-app panel edits and
  // the aligned view consumes (loadMetadata falls back to these meta fields
  // until a save writes the standalone per-camera files).
  const seedHomographies: CameraHomographies = {};
  const seedCorrespondences: CameraCorrespondences = {};
  const seedTransformTypes: CameraTransformTypes = {};
  const seedSourceStamps: { file: string; source: RegistrationSource | null }[] = [];
  if (isFolderArgs(args)) {
    // Parse the files up front so a bad file fails the import with a clear
    // message instead of storing partial state.
    await asyncForEach(Object.entries(args.sourceList), async ([cameraName, item]) => {
      if (!item.transformFile) {
        return;
      }
      try {
        // A DIVE registration .json (the panel's save format / the on-disk
        // per-camera file shape): pairs name their own cameras, so merge
        // them all in.
        const data = await fs.readJson(item.transformFile);
        if (!data || !Array.isArray(data.pairs)) {
          throw new Error('not a DIVE registration file (expected a "pairs" list)');
        }
        const parsed = fromRegistrationPairs(data.pairs);
        Object.entries(parsed.homographies).forEach(([key, homography]) => {
          if (!readTransformMatrix(homography.AtoB) || !readTransformMatrix(homography.BtoA)) {
            throw new Error(`pair "${key.split('::').join(' / ')}" has an invalid 3x3 transform matrix`);
          }
          seedHomographies[key] = homography;
        });
        Object.assign(seedCorrespondences, parsed.correspondences);
        Object.assign(seedTransformTypes, parsed.transformTypes);
        // Producer provenance travels with the seed; per-file stamps are
        // merged below (agreement keeps the stamp, disagreement is recorded
        // as a mixed composite so the client can warn).
        seedSourceStamps.push({
          file: item.transformFile.replace(/^.*[\\/]/, ''),
          source: (data.source && typeof data.source === 'object' && !Array.isArray(data.source))
            ? data.source as RegistrationSource
            : null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Camera "${cameraName}": invalid transform file: ${message}`);
      }
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
    name: (isFolderArgs(args) && args.datasetName?.trim())
      ? args.datasetName.trim()
      : 'Multi-camera data',
    multiCam: {
      cameras,
      calibration: args.calibrationFile,
      defaultDisplay: args.defaultDisplay,
    },
    subType: null,
  };
  if (Object.keys(seedHomographies).length || Object.keys(seedCorrespondences).length) {
    jsonMeta.cameraHomographies = seedHomographies;
    jsonMeta.cameraCorrespondences = seedCorrespondences;
    jsonMeta.cameraTransformTypes = seedTransformTypes;
    const seedRegistrationSource = mergeRegistrationSources(seedSourceStamps);
    if (seedRegistrationSource) {
      jsonMeta.cameraRegistrationSource = seedRegistrationSource;
    }
  }

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
    && jsonMeta.multiCam.cameras.right) {
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
    useNativePlayback: false,
    multiCamTrackFiles: trackFileCount === 0 ? null : multiCamTrackFiles,
  };
}

export default beginMultiCamImport;
