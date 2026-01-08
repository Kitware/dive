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
  websafeImageTypes, websafeVideoTypes, otherImageTypes, otherVideoTypes, metadataFileTypes,
  MultiType,
} from 'dive-common/constants';
import { preferEoIrSubfolderOrder } from 'dive-common/components/ImportMultiCamDialog/multicamSubfolderLayout';
import { inferCameraRoles } from 'dive-common/pipelineCameraOrder';
import {
  JsonConfig, JsonConfigCurrentVersion,
  DesktopMediaImportResponse,
  Camera,
} from 'platform/desktop/constants';
import { checkMedia } from 'platform/desktop/backend/native/mediaJobs';
import { readTransformMatrix } from 'vue-media-annotator/alignedView/alignedView';
import {
  mergeRegistrationSources, unknownCameraWarning,
} from 'vue-media-annotator/alignedView/cameraRegistrationFiles';
import { discoverMetadataAttachment, findImagesInFolder } from './common';
import {
  CameraHomographies,
  CameraObservations,
  CameraTransformTypes,
  fromRegistrationPairs,
  RegistrationPair,
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

/**
 * The display order persisted with the dataset: the import dialog's order
 * when given (matching what the web import stores), seeded from the
 * EO-first/IR-last name heuristic otherwise, with any unmentioned cameras
 * appended so the stored list always covers every camera.
 */
function buildCameraOrder(
  args: MultiCamImportArgs,
  cameras: Record<string, Camera>,
): string[] {
  const requested = (isFolderArgs(args) && args.cameraOrder) || [];
  const ordered = requested.filter((name) => name in cameras);
  const remaining = preferEoIrSubfolderOrder(
    Object.keys(cameras).filter((name) => !ordered.includes(name)),
  );
  return [...ordered, ...remaining];
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
    if (args.type === 'large-image') {
      throw new Error('large-image is not supported for multi-camera import');
    }
    const cameraType = args.type;
    const sourceDirectories = Object.fromEntries(
      Object.entries(args.sourceList).map(([key, item]) => [
        key,
        args.type === 'video' ? npath.dirname(item.sourcePath) : item.sourcePath,
      ]),
    );
    const sourceDirectoryCounts = Object.values(sourceDirectories).reduce(
      (counts, directory) => counts.set(directory, (counts.get(directory) || 0) + 1),
      new Map<string, number>(),
    );
    await asyncForEach(Object.entries(args.sourceList), async ([key, item]) => {
      const pathExists = fs.existsSync(item.sourcePath);
      if (!pathExists) {
        throw new Error(`file or directory for ${key} not found: ${item.sourcePath}`);
      }
      cameras[key] = {
        type: cameraType,
        originalBasePath: item.sourcePath,
        originalImageFiles: [],
        originalVideoFile: '',
        transcodedImageFiles: [],
        transcodedVideoFile: '',
      };
      // Discovery runs only when the user picked nothing for this camera, and only when the
      // camera owns its directory: a directory shared by several cameras is resolved once at
      // the dataset scope below.
      const sourceDirectory = sourceDirectories[key];
      const discoverable = !item.metadataFile
        && sourceDirectoryCounts.get(sourceDirectory) === 1;
      const cameraMetadataFile = item.metadataFile
        || (discoverable ? await discoverMetadataAttachment(sourceDirectory) : undefined);
      if (cameraMetadataFile) {
        if (!fs.existsSync(cameraMetadataFile) || !fs.statSync(cameraMetadataFile).isFile()) {
          throw new Error(`metadata file for ${key} not found: ${cameraMetadataFile}`);
        }
        const extension = npath.extname(cameraMetadataFile).slice(1).toLowerCase();
        if (!metadataFileTypes.includes(extension)) {
          throw new Error(`Camera "${key}" metadata must be a JSON, TXT, or CSV file`);
        }
        cameras[key].metadataFile = cameraMetadataFile;
        cameras[key].metadataOriginalName = npath.basename(cameraMetadataFile);
      }
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
  // the aligned view consumes (loadConfig falls back to these meta fields
  // until a save writes the standalone per-camera files).
  const seedHomographies: CameraHomographies = {};
  const seedCorrespondences: CameraObservations = {};
  const seedTransformTypes: CameraTransformTypes = {};
  const seedSourceStamps: { file: string; source: RegistrationSource | null }[] = [];
  const importWarnings: string[] = [];
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
        if (data.version !== 2) {
          throw new Error(
            `unsupported registration file version ${JSON.stringify(data.version)} `
            + '(expected 2); regenerate the file with a current producer',
          );
        }
        const parsed = fromRegistrationPairs(data.pairs);
        Object.entries(parsed.homographies).forEach(([key, homography]) => {
          if (!readTransformMatrix(homography.AtoB) || !readTransformMatrix(homography.BtoA)) {
            throw new Error(`pair "${key.split('::').join(' / ')}" has an invalid 3x3 transform matrix`);
          }
          seedHomographies[key] = homography;
        });
        Object.assign(seedCorrespondences, parsed.observations);
        Object.assign(seedTransformTypes, parsed.transformTypes);
        const fileName = item.transformFile.replace(/^.*[\\/]/, '');
        const warning = unknownCameraWarning(
          fileName,
          (data.pairs as RegistrationPair[]).flatMap((pair) => [pair.left, pair.right]),
          Object.keys(cameras),
        );
        if (warning) {
          importWarnings.push(warning);
        }
        // Producer provenance travels with the seed; per-file stamps are
        // merged below (agreement keeps the stamp, disagreement is recorded
        // as a mixed composite so the client can warn).
        seedSourceStamps.push({
          file: fileName,
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

  let sharedMetadataFile: string | undefined;
  if (isFolderArgs(args)) {
    const cameraDirectories = Object.values(args.sourceList).map((item) => (
      args.type === 'video' ? npath.dirname(item.sourcePath) : item.sourcePath
    ));
    const uniqueCameraDirectories = [...new Set(cameraDirectories)];
    const parentCandidates = [...new Set(
      uniqueCameraDirectories.map((path) => npath.dirname(path)),
    )];
    let sharedDirectory: string | undefined;
    if (uniqueCameraDirectories.length === 1) {
      [sharedDirectory] = uniqueCameraDirectories;
    } else if (parentCandidates.length === 1) {
      [sharedDirectory] = parentCandidates;
    }
    sharedMetadataFile = args.metadataFile
      || (sharedDirectory ? await discoverMetadataAttachment(sharedDirectory) : undefined);
  } else {
    sharedMetadataFile = args.metadataFile || undefined;
  }

  const jsonConfig: JsonConfig = {
    version: JsonConfigCurrentVersion,
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
      cameraOrder: buildCameraOrder(args, cameras),
      calibration: args.calibrationFile,
      defaultDisplay: args.defaultDisplay,
    },
    subType: null,
  };
  if (Object.keys(seedHomographies).length || Object.keys(seedCorrespondences).length) {
    jsonConfig.cameraHomographies = seedHomographies;
    jsonConfig.cameraCorrespondences = seedCorrespondences;
    jsonConfig.cameraTransformTypes = seedTransformTypes;
    const seedRegistrationSource = mergeRegistrationSources(seedSourceStamps);
    if (seedRegistrationSource) {
      jsonConfig.cameraRegistrationSource = seedRegistrationSource;
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
            jsonConfig.originalVideoFile = npath.basename(video);
          }
          if (mimetype) {
            if (websafeImageTypes.includes(mimetype) || otherImageTypes.includes(mimetype)) {
              throw new Error('User chose image file for video import option');
            } else if (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype)) {
              const checkMediaResult = await checkMedia(video);
              if (!checkMediaResult.websafe || otherVideoTypes.includes(mimetype)) {
                mediaConvertList.push(video);
              }
              if (jsonConfig.multiCam && jsonConfig.multiCam.cameras[cameraName] !== undefined) {
                jsonConfig.multiCam.cameras[cameraName].originalVideoFile = npath.basename(video);
              }
              const newAnnotationFps = Math.floor(
                Math.min(jsonConfig.fps, checkMediaResult.originalFps),
              );
              if (newAnnotationFps <= 0) {
                throw new Error('fps < 1 unsupported');
              }
              jsonConfig.originalFps = checkMediaResult.originalFps;
              jsonConfig.fps = newAnnotationFps;
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
          const found = await findImagesInFolder(item.sourcePath, item.glob);
          if (found.imagePaths.length === 0) {
            throw new Error(`no images found in ${item.sourcePath}${item.glob ? ` matching ${item.glob}` : ''}`);
          }
          mediaConvertList = mediaConvertList.concat(found.mediaConvertList);
          if (found.source === 'directory') {
            cameras[cameraName].originalImageFiles = found.imageNames;
          } else if (found.source === 'image-list') {
            cameras[cameraName].originalImageFiles = found.imagePaths;
            cameras[cameraName].imageListPath = jsonConfig.originalBasePath;
            cameras[cameraName].originalBasePath = '';
          }
        },
      );
    } else if (isKeywordArgs(args)) {
      jsonConfig.originalBasePath = args.sourcePath;
      await asyncForEach(
        Object.entries(args.globList),
        async ([cameraName, item]) => {
          const found = await findImagesInFolder(args.sourcePath, item.glob);
          mediaConvertList = mediaConvertList.concat(found.mediaConvertList);
          if (found.source === 'directory') {
            cameras[cameraName].originalImageFiles = found.imageNames;
          } else if (found.source === 'image-list') {
            cameras[cameraName].originalImageFiles = found.imagePaths;
            cameras[cameraName].imageListPath = jsonConfig.originalBasePath;
            cameras[cameraName].originalBasePath = '';
          }
        },
      );
    }
  } else {
    throw new Error('only video and image-sequence types are supported');
  }

  if (jsonConfig.multiCam?.cameras && jsonConfig.multiCam.cameras.left
    && jsonConfig.multiCam.cameras.right) {
    jsonConfig.subType = 'stereo';
  } else if (jsonConfig.multiCam) {
    jsonConfig.subType = 'multicam';
  }

  if (mediaConvertList.length && Object.values(cameras).some((cam) => cam.imageListPath)) {
    throw new Error('Transcoding is not supported when an image list is used');
  }

  // Shared attachment travels on the response (like beginMediaImport), not on
  // jsonConfig: ImportDialog binds metadataFileAbsPath so the user can see and clear it.
  // finalizeMediaImport still accepts jsonConfig.metadataFile as a fallback for older callers.
  // Sensor role per camera, from the camera name and (for image sequences)
  // the image names; the pipeline camera-assignment step prefills from it
  // and the user can correct it there.
  const cameraRoles = inferCameraRoles(Object.fromEntries(
    Object.entries(cameras).map(([name, camera]) => [
      name,
      camera.originalImageFiles.length ? camera.originalImageFiles : [camera.originalVideoFile],
    ]),
  ));
  if (Object.keys(cameraRoles).length) {
    jsonConfig.cameraRoles = cameraRoles;
  }

  return {
    jsonConfig,
    globPattern: '',
    mediaConvertList,
    trackFileAbsPath: '',
    forceMediaTranscode: false,
    useNativePlayback: false,
    multiCamTrackFiles: trackFileCount === 0 ? null : multiCamTrackFiles,
    ...(sharedMetadataFile ? { metadataFileAbsPath: sharedMetadataFile } : {}),
    ...(importWarnings.length ? { importWarnings } : {}),
  };
}

export default beginMultiCamImport;
