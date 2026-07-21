/**
 * Common native implementations
 */

import npath from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { shell } from 'electron';
import mime from 'mime-types';
import moment from 'moment';
import lockfile from 'proper-lockfile';
import {
  cloneDeep, merge, uniq, pick,
} from 'lodash';

import { DefaultConfidence } from 'vue-media-annotator/BaseFilterControls';
import { TrackData } from 'vue-media-annotator/track';
import { GroupData } from 'vue-media-annotator/Group';
import {
  DatasetType, Pipelines, SaveDetectionsArgs,
  FrameImage, DatasetMetaMutable, TrainingConfig, TrainingConfigs, SaveAttributeArgs,
  MultiCamMedia,
  DatasetMetaMutableKeys,
  AnnotationSchema,
  SaveAttributeTrackFilterArgs,
  Pipe,
  PipeMetadata,
  PipelineParamType,
} from 'dive-common/apispec';
import * as viameSerializers from 'platform/desktop/backend/serializers/viame';
import * as nistSerializers from 'platform/desktop/backend/serializers/nist';
import * as dive from 'platform/desktop/backend/serializers/dive';
import * as coco from 'platform/desktop/backend/serializers/coco';
import kpf from 'platform/desktop/backend/serializers/kpf';
// TODO:  Check to Refactor this
// eslint-disable-next-line import/no-cycle
import { checkMedia } from 'platform/desktop/backend/native/mediaJobs';
import {
  websafeImageTypes, websafeVideoTypes, otherImageTypes, otherVideoTypes, fileVideoTypes,
  MultiType, JsonMetaRegEx, largeImageDesktopTypes,
} from 'dive-common/constants';
import {
  JsonMeta, Settings, JsonMetaCurrentVersion, DesktopMetadata,
  RunTraining, ExportDatasetArgs, DesktopMediaImportResponse,
  ExportConfigurationArgs, JobsFolderName, JobsOutputFolderName, ProjectsFolderName,
  PipelinesFolderName, ConversionArgs,
  JobType,
} from 'platform/desktop/constants';
import {
  cleanString, filterByGlob, makeid, strNumericCompare,
} from 'platform/desktop/sharedUtils';
import { parseFrameTimestamp } from 'dive-common/frameTimestamp';

import processTrackAttributes from './attributeProcessor';
import { upgrade } from './migrations';
// TODO:  Check to Refactor this
// eslint-disable-next-line import/no-cycle
import { getMultiCamUrls, transcodeMultiCam } from './multiCamUtils';
import {
  loadRegistrationFiles, referenceCameraName, saveRegistrationToDatasetDir,
} from './cameraRegistration';
import { prepareDatasetCalibration } from './calibrationConvert';
import { realCalibrationName } from './datasetCalibration';
import { splitExt } from './utils';

const AuxFolderName = 'auxiliary';

const JsonTrackFileName = /^result(_.*)?\.json$/i;
const JsonFileName = /^.*\.json$/i;
const JsonMetaFileName = 'meta.json';
const CsvFileName = /^.*\.csv$/i;
const YAMLFileName = /^.*\.ya?ml$/i;
/**
 * Read a text file into a list of lines
 */
async function readLines(filePath: string): Promise<string[]> {
  const rawBuffer = await fs.readFile(filePath, 'utf-8');
  return rawBuffer.toString().replace(/\r\n/g, '\n').split('\n');
}

/**
 * Extract metadata from a .pipe file header.
 */
async function extractPipeMetadata(filePath: string): Promise<PipeMetadata> {
  const metadata: PipeMetadata = {};
  metadata.diveParams = [];
  try {
    const lines = await readLines(filePath);
    let inDescription = false;
    let contextStack: string[] = [];
    let fullDescription = '';

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const processMatch = trimmed.match(/^process\s+([\w-]+)/i);
      if (processMatch) {
        contextStack = [processMatch[1]];
        return;
      }

      const blockMatch = trimmed.match(/^block\s+([\w:-]+)/i);
      if (blockMatch) {
        contextStack.push(blockMatch[1]);
        return;
      }

      if (trimmed.toLowerCase() === 'endblock') {
        contextStack.pop();
        return;
      }

      const diveMatch = line.match(/#\s*DIVE_PARAM\s*\[\s*"([^"]+)"\s*,\s*(.+)\s*\]/i);
      if (diveMatch) {
        const [, label, rawArgs] = diveMatch;
        const args = rawArgs.split(',').map((arg) => arg.trim());
        const type: PipelineParamType = args[0] as PipelineParamType;
        const restArgs = args.slice(1);
        // `required` is a flag keyword — strip it from type_props,
        // everything else stays positional for the type.
        const isRequired = restArgs.some((a) => a.toLowerCase() === 'required');
        const pipelineTypeArgs = restArgs.filter((a) => a.toLowerCase() !== 'required');

        // `config <key> = <value>` — absolute kwiver key, no process/block prefix
        // applied. Used for global / cross-referenced settings.
        const configMatch = trimmed.match(/^config\s+([\w:.-]+)\s*=\s*([^#]+)/i);
        // Otherwise a regular per-process/block parameter assignment.
        const paramLineMatch = !configMatch
          ? trimmed.match(/^(?:relativepath\s+)?(?::)?([\w:-]+)\s*=?\s*([^#]+)/i)
          : null;

        let fullKey: string | null = null;
        let defaultValue: string | null = null;
        if (configMatch) {
          const [, key, value] = configMatch;
          fullKey = key;
          defaultValue = value.trim();
        } else if (paramLineMatch) {
          fullKey = [...contextStack, paramLineMatch[1]].join(':');
          defaultValue = paramLineMatch[2].trim();
        }

        if (fullKey !== null && defaultValue !== null) {
          metadata.diveParams!.push({
            label,
            type,
            type_props: pipelineTypeArgs,
            key: fullKey,
            default: defaultValue,
            ...(isRequired ? { required: true } : {}),
          });
        }
      }

      // --- Description extraction (Multiline) ---
      if (/^#\s*Description:\s*/i.test(line)) {
        inDescription = true;
        fullDescription = line.replace(/^#\s*Description:\s*/i, '').trim();
        return;
      }

      if (inDescription) {
        if (/^#\s*$/.test(line) || /^#\s*=/.test(line) || /^#\s*(Input|Output|Requires\s+Calibration|Metadata\s+File|Image\s+List\s+Keys?):/i.test(line) || !line.startsWith('#')) {
          inDescription = false;
        } else {
          fullDescription += ` ${line.replace(/^#\s*/, '').trim()}`;
          return;
        }
      }

      // --- Input / Output extraction ---
      if (/^#\s*Input:\s*/i.test(line)) {
        metadata.inputType = line.split(':')[1]?.trim();
      }
      if (/^#\s*Output:\s*/i.test(line)) {
        metadata.outputType = line.split(':')[1]?.trim();
      }

      const calibrationMatch = line.match(/^#\s*Requires\s+Calibration:\s*(.*)/i);
      if (calibrationMatch) {
        const value = calibrationMatch[1].trim().toLowerCase();
        metadata.requiresCalibration = ['true', 'yes', '1'].includes(value);
      }

      // `# Metadata File: <block>:<key>` opts a pipe in to receiving the
      // dataset's optional metadata file as a `-s <block>:<key>=<path>` override.
      const metadataFileMatch = line.match(/^#\s*Metadata\s+File:\s*(.+)/i);
      if (metadataFileMatch) {
        const value = metadataFileMatch[1].trim();
        if (value) {
          metadata.metadataFileKey = value;
        }
      }

      // `# Image List Keys: <k> [k...]` binds the run's input image list(s) (one
      // per camera; multicam comma-joined) to each key, so pipes (e.g. the
      // sea-lion registration stabilizer) read the same image list DIVE feeds the
      // input reader.
      const imageListMatch = line.match(/^#\s*Image\s+List\s+Keys?:\s*(.+)/i);
      if (imageListMatch) {
        const keys = imageListMatch[1].trim().split(/[\s,]+/).filter((k) => k);
        if (keys.length) {
          metadata.imageListKeys = keys;
        }
      }
    });
    metadata.description = fullDescription.trim() || undefined;
  } catch (error) {
    console.error(`Error while reading ${filePath} metadata`, error);
  }

  return metadata;
}

/**
 * Read a text file as json
 */
async function _loadAsJson(abspath: string) {
  const rawBuffer = await fs.readFile(abspath, 'utf-8');
  if (rawBuffer.length === 0) {
    return false;
  }
  try {
    return JSON.parse(rawBuffer);
  } catch (err) {
    throw new Error(`Unable to parse ${abspath}: ${err}`);
  }
}

/**
 * findImagesInFolder
 * Import either a directory of images or images from a text file
 * Images returned will be MIME-validated and guaranteed to exist on disk.
 * Actual file contents will not be checked.
 */
async function findImagesInFolder(path: string, glob?: string) {
  const filteredImagePaths: string[] = [];
  let requiresTranscoding = false;
  let imagePaths: string[];
  const stat = await fs.stat(path);
  let source: 'directory' | 'image-list' = 'directory';

  if (stat.isDirectory()) {
    imagePaths = (await fs.readdir(path))
      .map((name) => npath.join(path, name));
  } else {
    source = 'image-list';
    imagePaths = (await readLines(path))
      // remove lines that are just whitespace
      .filter((line) => line.trim())
      // Transform relative paths to absolute paths using list directory location.
      .map((line) => {
        if (npath.isAbsolute(line)) {
          return npath.normalize(line);
        }
        return npath.join(npath.dirname(path), line);
      });
    if (imagePaths.length === 0) {
      throw new Error('No images in input image list');
    }
    if (uniq(imagePaths).length !== imagePaths.length) {
      throw new Error('Duplicate entries detected in image list');
    }
    // Need to assert that every file in the image list exists
    for (let i = 0; i < imagePaths.length; i += 1) {
      const absPath = imagePaths[i];
      // eslint-disable-next-line no-await-in-loop
      if (!(await fs.pathExists(absPath))) {
        throw new Error(`Image from image list ${absPath} was not found`);
      }
    }
  }

  imagePaths.forEach((absPath) => {
    const mimetype = mime.lookup(absPath);
    const filename = npath.basename(absPath);
    if (glob === undefined || filterByGlob(glob, [filename]).length === 1) {
      if (
        mimetype && (websafeImageTypes.includes(mimetype)
          || otherImageTypes.includes(mimetype))
      ) {
        filteredImagePaths.push(absPath);
        if (otherImageTypes.includes(mimetype)) {
          requiresTranscoding = true;
        }
      } else if (source === 'image-list') {
        /* A non-image was found in an image list */
        throw new Error('Found non-image type data in image list file');
      }
    }
  });

  return {
    imagePaths: filteredImagePaths,
    imageNames: filteredImagePaths.map((absPath) => npath.basename(absPath)),
    mediaConvertList: requiresTranscoding ? filteredImagePaths : [],
    source,
  };
}

async function _acquireLock(dir: string, resource: string, lockname: 'meta' | 'tracks') {
  const release = await lockfile.lock(resource, {
    stale: 5000, // 5 seconds
    lockfilePath: npath.join(dir, `${lockname}.lock`),
  });
  return release;
}

async function _findCSVTrackFiles(searchPath: string) {
  const contents = await fs.readdir(searchPath);
  const csvFileCandidates = contents
    .filter((v) => CsvFileName.test(v))
    .map((filename) => npath.join(searchPath, filename));
  return csvFileCandidates;
}

/**
 * locate json track file in a directory
 * @param path path to a directory
 * @returns object containing trackAbsPath and metaPath if it exists
 */
async function _findJsonAndMetaTrackFile(basePath: string): Promise<
  {trackFileAbsPath: string; metaFileAbsPath?: string}> {
  const contents = await fs.readdir(basePath);
  const jsonFileCandidates: string[] = [];
  let metaFileAbsPath: undefined | string;
  await Promise.all(contents.map(async (name) => {
    const fullPath = npath.join(basePath, name);
    if (JsonTrackFileName.test(name)) {
      const statResult = await fs.stat(fullPath);
      if (statResult.isFile()) {
        jsonFileCandidates.push(fullPath);
      }
    } else if (JsonMetaRegEx.test(name)) {
      metaFileAbsPath = fullPath;
    }
  }));
  if (jsonFileCandidates.length > 0) {
    return { trackFileAbsPath: jsonFileCandidates[0], metaFileAbsPath };
  }
  return { trackFileAbsPath: '', metaFileAbsPath };
}

/**
 * getProjectDir returns filepaths to required members of a dataset project directory.
 */
function getProjectDir(settings: Settings, datasetId: string) {
  const basePath = npath.join(settings.dataPath, ProjectsFolderName, datasetId);
  const auxDirAbsPath = npath.join(basePath, AuxFolderName);
  const metaFileAbsPath = npath.join(basePath, JsonMetaFileName);
  return {
    auxDirAbsPath,
    basePath,
    metaFileAbsPath,
  };
}

/**
 * REQUIRED members: meta.json, results*.json
 * OPTIONAL members: aux/ will be created if none exists
 */
async function getValidatedProjectDir(settings: Settings, datasetId: string) {
  const projectInfo = getProjectDir(settings, datasetId);
  fs.ensureDirSync(projectInfo.auxDirAbsPath);
  if (!fs.pathExistsSync(projectInfo.basePath)) {
    throw new Error(`missing project directory ${projectInfo.basePath}`);
  }
  if (!fs.pathExistsSync(projectInfo.metaFileAbsPath)) {
    throw new Error(`missing metadata json file ${projectInfo.metaFileAbsPath}`);
  }
  const { trackFileAbsPath } = await _findJsonAndMetaTrackFile(projectInfo.basePath);
  if (trackFileAbsPath === '') {
    throw new Error(`missing track json file in ${projectInfo.basePath}`);
  }
  return {
    ...projectInfo,
    trackFileAbsPath,
  };
}

/**
 * loadJsonMeta processes dataset information from json
 * @param metaPath a known, existing path
 */
async function loadJsonMetadata(metaAbsPath: string): Promise<JsonMeta> {
  const metaJson = await _loadAsJson(metaAbsPath);
  /* check if this file meets the current schema version */
  upgrade(metaJson);
  return metaJson as JsonMeta;
}

/**
 * loadAnnotationFile load from file
 * @param tracksPath a known, existing path
 */
async function loadAnnotationFile(tracksAbsPath: string): Promise<AnnotationSchema> {
  const annotationData = await _loadAsJson(tracksAbsPath);
  return dive.migrate(annotationData);
}

async function loadMetadata(
  settings: Settings,
  datasetId: string,
  makeMediaUrl: (path: string) => string,
): Promise<DesktopMetadata> {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  const projectMetaData = await loadJsonMetadata(projectDirData.metaFileAbsPath);

  // Load the standalone camera registration (transforms + correspondences)
  // from the per-camera *_registration.json files, if present; the dataset
  // meta fields serve as the import-time seed until a save writes the files.
  let {
    cameraHomographies, cameraCorrespondences, cameraTransformTypes, cameraRegistrationSource,
  } = projectMetaData;
  const loadedCalibration = await loadRegistrationFiles(projectDirData.basePath);
  if (loadedCalibration.found) {
    ({
      homographies: cameraHomographies,
      correspondences: cameraCorrespondences,
      transformTypes: cameraTransformTypes,
      source: cameraRegistrationSource,
    } = loadedCalibration);
  }

  let videoUrl = '';
  let nativeVideoPath: string | undefined;
  let imageData = [] as FrameImage[];
  let multiCamMedia: MultiCamMedia | null = null;
  const { subType } = projectMetaData;
  /* Generate URLs against embedded media server from known file paths on disk */
  if (projectMetaData.type === MultiType) {
    // Returns the type of the defaultDisplay for the multicam
    if (!projectMetaData.multiCam) {
      throw new Error(`Dataset: ${projectMetaData.name} is of type multiCam or stereo but contains no multiCam data`);
    }
    multiCamMedia = getMultiCamUrls(projectMetaData, projectDirData.basePath, makeMediaUrl);
    /* TODO: Done temporarily before we support true display of items */
    const defaultDisplay = multiCamMedia.cameras[multiCamMedia.defaultDisplay];
    imageData = defaultDisplay.imageData;
    videoUrl = defaultDisplay.videoUrl;
  } else if (projectMetaData.type === 'video') {
    /* If using native playback (no transcoding), provide the native video path */
    if (projectMetaData.useNativePlayback) {
      // Get the original video path for native playback
      const originalVideoPath = npath.join(
        projectMetaData.originalBasePath,
        projectMetaData.originalVideoFile,
      );
      // For native playback, we pass the file path directly (not a URL)
      // The frontend will use the frame extraction API
      nativeVideoPath = originalVideoPath;
      // Still provide videoUrl as empty - frontend will use nativeVideoPath instead
      videoUrl = '';
    } else if (projectMetaData.transcodedVideoFile) {
      /* Use transcoded output only after it exists on disk. */
      const transcodedVideo = npath.join(projectDirData.basePath, projectMetaData.transcodedVideoFile);
      if (await fs.pathExists(transcodedVideo)) {
        videoUrl = makeMediaUrl(transcodedVideo);
      } else if (projectMetaData.originalBasePath && projectMetaData.originalVideoFile) {
        const originalVideo = npath.join(projectMetaData.originalBasePath, projectMetaData.originalVideoFile);
        videoUrl = makeMediaUrl(originalVideo);
      } else {
        // Some legacy/test metadata only has a transcoded filename.
        videoUrl = makeMediaUrl(transcodedVideo);
      }
    } else {
      const video = npath.join(projectMetaData.originalBasePath, projectMetaData.originalVideoFile);
      videoUrl = makeMediaUrl(video);
    }
  } else if (projectMetaData.type === 'image-sequence') {
    if (projectMetaData.transcodedImageFiles && projectMetaData.transcodedImageFiles.length) {
      imageData = projectMetaData.transcodedImageFiles.map((filename: string) => ({
        url: makeMediaUrl(npath.join(projectDirData.basePath, filename)),
        filename,
        timestamp: parseFrameTimestamp(filename),
      }));
    } else {
      imageData = projectMetaData.originalImageFiles.map((pathOrFilename: string) => {
        const absPath = npath.join(projectMetaData.originalBasePath, pathOrFilename);
        const filename = npath.basename(absPath);
        return {
          url: makeMediaUrl(absPath),
          filename,
          timestamp: parseFrameTimestamp(filename),
        };
      });
    }
  } else if (projectMetaData.type === 'large-image' && projectMetaData.originalLargeImageFile) {
    const tiffPath = npath.join(projectMetaData.originalBasePath, projectMetaData.originalLargeImageFile);
    imageData = [{
      url: makeMediaUrl(tiffPath),
      id: datasetId,
      filename: npath.basename(tiffPath),
    }];
  } else {
    throw new Error(`unexpected project type for id="${datasetId}" type="${projectMetaData.type}"`);
  }
  // Redirecting type to image-sequence or video for multi camera types
  return {
    ...projectMetaData,
    videoUrl,
    nativeVideoPath,
    imageData,
    multiCamMedia,
    subType,
    cameraHomographies,
    cameraCorrespondences,
    cameraTransformTypes,
    cameraRegistrationSource,
  };
}

async function loadDetections(settings: Settings, datasetId: string) {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  return loadAnnotationFile(projectDirData.trackFileAbsPath);
}

/**
 * Look through DIVE project path, find subfolders that
 * look like datasets, and return them.
 */
async function autodiscoverData(settings: Settings): Promise<JsonMeta[]> {
  const dspath = npath.join(settings.dataPath, ProjectsFolderName);
  const dsids = await fs.readdir(dspath);
  const metas: JsonMeta[] = [];
  /* eslint-disable no-await-in-loop,no-continue */
  for (let i = 0; i < dsids.length; i += 1) {
    const datasetId = dsids[i];
    try {
      const projectDirData = await getValidatedProjectDir(settings, datasetId);
      const metadata = await loadJsonMetadata(projectDirData.metaFileAbsPath);
      metas.push(metadata);
    } catch {
      // noop, dataset was invalid
    }
  }
  /* eslint-enable */
  return metas;
}

/**
 * Get all runnable pipelines
 * @param settings app settings
 */
async function getPipelineList(settings: Settings): Promise<Pipelines> {
  const pipelinePath = npath.join(settings.viamePath, 'configs/pipelines');
  const allowedPatterns = /^filter_.+|^transcode_.+|^detector_.+|^tracker_.+|^generate_.+|^utility_|^measurement_.+|.*[2,3]-cam.+/;
  const disallowedPatterns = /.*local.*|common_stereo_.*|detector_svm_models.pipe|tracker_svm_models.pipe/;
  const exists = await fs.pathExists(pipelinePath);
  if (!exists) return {};
  let pipes = await fs.readdir(pipelinePath);
  pipes = pipes.filter((p) => p.match(allowedPatterns) && !p.match(disallowedPatterns));

  /* TODO: fetch trained pipelines */
  const ret: Pipelines = {};

  await Promise.all(pipes.map(async (p) => {
    const parts = cleanString(p.replace('.pipe', '')).split('_');
    let pipeType = parts[0];
    let pipeName = parts.slice(1).join(' ');
    // Extract out only 2-cam and 3-cam pipelines to own category, 1-cam remain in tracker/detector
    if (parts.length > 1 && parts[parts.length - 1] === 'cam' && parts[parts.length - 2] !== '1') {
      pipeType = `${parts[parts.length - 2]}-cam`;
      pipeName = parts.join(' ');
    }

    // Extract description and metadata from the pipe file
    const pipeFilePath = npath.join(pipelinePath, p);
    const metadata = await extractPipeMetadata(pipeFilePath);

    const pipeInfo: Pipe = {
      name: pipeName,
      type: pipeType,
      pipe: p,
      metadata,
    };
    if (pipeType in ret) {
      ret[pipeType].pipes.push(pipeInfo);
    } else {
      ret[pipeType] = {
        pipes: [pipeInfo],
        description: '',
      };
    }
  }));

  // Now lets add to it the trained pipelines by recursively looking in the dir
  const allowedTrainedPatterns = new RegExp([
    '^detector.+',
    '^tracker.+',
    '^generate.+',
    '^.*\\.zip',
    '^.*\\.svm',
    '^.*\\.lbl',
    '^.*\\.cfg',
    '^.*\\.yaml',
  ].join('|'));
  const trainedPipelinePath = npath.join(settings.dataPath, PipelinesFolderName);
  const trainedExists = await fs.pathExists(trainedPipelinePath);
  if (!trainedExists) return ret;
  const trainedPipeFolders = await fs.readdir(trainedPipelinePath);
  await Promise.all(trainedPipeFolders.map(async (item) => {
    const pipeFolder = npath.join(trainedPipelinePath, item);
    const pipeFolderExists = await fs.pathExists(pipeFolder);
    if (!pipeFolderExists) return false;
    let pipesInFolder = await fs.readdir(pipeFolder);
    pipesInFolder = pipesInFolder.filter(
      (p: string) => p.match(allowedTrainedPatterns) && !p.match(disallowedPatterns),
    );
    if (pipesInFolder.length >= 2) {
      const pipeName = pipesInFolder.find((pipe) => pipe && pipe.indexOf('.pipe') !== -1);
      if (pipeName) {
        const pipeInfo = {
          name: item,
          type: 'trained',
          pipe: npath.join(pipeFolder, pipeName),
        };
        if ('trained' in ret) {
          ret.trained.pipes.push(pipeInfo);
        } else {
          ret.trained = {
            pipes: [pipeInfo],
            description: 'trained pipes',
          };
        }
      }
    }
    return true;
  }));
  return ret;
}

// Function to recursively traverse a directory and collect files with specified extensions
function getFilesWithExtensions(dir: string, extensions: string[], fileList: string[] = []) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = npath.join(dir, file);
    const fileStat = fs.statSync(filePath);

    if (fileStat.isDirectory()) {
      fileList.concat(getFilesWithExtensions(filePath, extensions, fileList));
    } else {
      const fileExtension = npath.extname(file).toLowerCase();
      if (extensions.includes(fileExtension)) {
        fileList.push(filePath);
      }
    }
  });

  return fileList;
}

/**
 * get training configurations
 */
async function getTrainingConfigs(settings: Settings): Promise<TrainingConfigs> {
  const pipelinePath = npath.join(settings.viamePath, 'configs/pipelines');
  const defaultTrainingConfiguration = 'train_detector_default.conf';
  const allowedPatterns = /train_.*\.conf$/;
  const disallowedPatterns = /.*(_nf|\.continue)\.viame_csv\.conf$/;
  const allowedModelExtensions = ['.zip', '.pth', '.pt', '.py', '.weights', '.wt'];
  const exists = await fs.pathExists(pipelinePath);
  if (!exists) {
    throw new Error(`Path does not exist: ${pipelinePath}`);
  }
  let configNames = await fs.readdir(pipelinePath);
  configNames = configNames
    .filter((p) => (p.match(allowedPatterns) && !p.match(disallowedPatterns)))
    .sort((a, b) => (a === defaultTrainingConfiguration ? -1 : a.localeCompare(b)));

  const configs: TrainingConfig[] = await Promise.all(configNames.map(async (name) => {
    const configFilePath = npath.join(pipelinePath, name);
    const { description } = (await extractPipeMetadata(configFilePath));
    return { name, description };
  }));

  // Get Model files in the pipeline directory
  const modelList = getFilesWithExtensions(pipelinePath, allowedModelExtensions);
  const models: TrainingConfigs['models'] = {};
  modelList.forEach((model) => {
    models[npath.basename(model)] = {
      name: npath.basename(model),
      type: npath.extname(model),
      path: model,
    };
  });
  return {
    training: {
      default: configNames[0],
      configs,
    },
    models,
  };
}

/**
 * delete a trained pipeline
 */
async function deleteTrainedPipeline(pipeline: Pipe): Promise<void> {
  if (pipeline.type !== 'trained') throw new Error(`${pipeline.name} is not a trained pipeline`);

  const parent = npath.parse(pipeline.pipe).dir;
  await fs.remove(parent);
}

/**
 * _saveSerialized save pre-serialized tracks to disk
 */
async function _saveSerialized(
  settings: Settings,
  datasetId: string,
  data: AnnotationSchema,
  allowEmpty = false,
) {
  const time = moment().format('MM-DD-YYYY_hh-mm-ss.SSS');
  const newFileName = `result_${time}.json`;
  const projectInfo = getProjectDir(settings, datasetId);
  const release = await _acquireLock(projectInfo.basePath, projectInfo.basePath, 'tracks');

  try {
    const validatedInfo = await getValidatedProjectDir(settings, datasetId);
    await fs.move(
      validatedInfo.trackFileAbsPath,
      npath.join(
        validatedInfo.auxDirAbsPath,
        npath.basename(validatedInfo.trackFileAbsPath),
      ),
    );
  } catch (err) {
    // Some part of the project dir didn't exist
    if (!allowEmpty) throw err;
  }
  const serialized = JSON.stringify(data);
  await fs.writeFile(npath.join(projectInfo.basePath, newFileName), serialized);
  await release();
}

/**
 * Save detections to json file in aux
 */
async function saveDetections(settings: Settings, datasetId: string, args: SaveDetectionsArgs) {
  /* Update existing track file */
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  const existing = await loadAnnotationFile(projectDirInfo.trackFileAbsPath);
  function _save(type: 'tracks' | 'groups') {
    args[type].delete.forEach((id) => delete existing[type][id.toString()]);
    args[type].upsert.forEach((val: TrackData | GroupData) => {
      existing[type][val.id.toString()] = val;
    });
  }
  _save('tracks');
  _save('groups');
  return _saveSerialized(settings, datasetId, existing);
}

/**
 * _saveAsJson saves directly to disk
 */
async function _saveAsJson(absPath: string, data: unknown) {
  const serialized = JSON.stringify(data, null, 2);
  await fs.writeFile(absPath, serialized);
}

async function saveMetadata(settings: Settings, datasetId: string, args: DatasetMetaMutable) {
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  const release = await _acquireLock(projectDirInfo.basePath, projectDirInfo.metaFileAbsPath, 'meta');
  const existing = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  if (args.confidenceFilters) {
    existing.confidenceFilters = args.confidenceFilters;
  }
  if (args.imageEnhancements) {
    existing.imageEnhancements = args.imageEnhancements;
  }
  if (args.customTypeStyling) {
    existing.customTypeStyling = args.customTypeStyling;
  }
  if (args.customGroupStyling) {
    existing.customGroupStyling = args.customGroupStyling;
  }
  if (args.attributes) {
    existing.attributes = args.attributes;
  }
  if (args.timeFilters !== undefined) {
    existing.timeFilters = args.timeFilters;
  }
  if (args.error) {
    existing.error = args.error;
  }
  if (args.datasetInfo) {
    existing.datasetInfo = args.datasetInfo;
  }

  // The camera registration (transforms + the points behind them) is
  // persisted as standalone <camera>_to_<reference>_registration.json files
  // in the dataset directory rather than embedded in meta.json, so each
  // camera's registration is easy to find, hand-edit, and consume as a
  // self-contained artifact. There is deliberately never a single all-pairs
  // file.
  if (args.cameraHomographies || args.cameraCorrespondences || args.cameraTransformTypes
    || args.cameraRegistrationSource) {
    await saveRegistrationToDatasetDir(
      projectDirInfo.basePath,
      args,
      referenceCameraName(existing),
    );
  }

  await _saveAsJson(projectDirInfo.metaFileAbsPath, existing);
  await release();
}

async function saveAttributes(settings: Settings, datasetId: string, args: SaveAttributeArgs) {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  const projectMetaData = await loadJsonMetadata(projectDirData.metaFileAbsPath);
  if (!projectMetaData.attributes) {
    projectMetaData.attributes = {};
  }
  args.delete.forEach((attributeId) => {
    if (projectMetaData.attributes && projectMetaData.attributes[attributeId]) {
      delete projectMetaData.attributes[attributeId];
    }
  });
  args.upsert.forEach((attribute) => {
    if (projectMetaData.attributes) {
      projectMetaData.attributes[attribute.key] = attribute;
    }
  });
  await saveMetadata(settings, datasetId, projectMetaData);
}

async function saveAttributeTrackFilters(
  settings: Settings,
  datasetId: string,
  args: SaveAttributeTrackFilterArgs,
) {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  const projectMetaData = await loadJsonMetadata(projectDirData.metaFileAbsPath);
  if (!projectMetaData.attributeTrackFilters) {
    projectMetaData.attributeTrackFilters = {};
  }
  args.delete.forEach((filterId) => {
    if (projectMetaData.attributeTrackFilters && projectMetaData.attributeTrackFilters[filterId]) {
      delete projectMetaData.attributeTrackFilters[filterId];
    }
  });
  args.upsert.forEach((filter) => {
    if (projectMetaData.attributeTrackFilters) {
      projectMetaData.attributeTrackFilters[filter.name] = filter;
    }
  });
  await saveMetadata(settings, datasetId, projectMetaData);
}

async function _ingestFilePath(
  settings: Settings,
  datasetId: string,
  path: string,
  imageMap?: Map<string, number>,
  additive = false,
  additivePrepend = '',
): Promise<[(DatasetMetaMutable & { fps?: number }), string[]] | null> {
  if (!fs.existsSync(path)) {
    return null;
  }
  if (fs.statSync(path).size === 0) {
    return null;
  }
  let warnings: string[] = [];
  // Make a copy of the file in aux
  const projectInfo = getProjectDir(settings, datasetId);
  const newPath = npath.join(projectInfo.auxDirAbsPath, `imported_${npath.basename(path)}`);
  await fs.copy(path, newPath);
  // Attempt to process the file
  let annotations = dive.makeEmptyAnnotationFile();
  const meta: DatasetMetaMutable & { fps?: number, execTime?: number } = {};
  let metadataConfig = false;
  if (JsonFileName.test(path)) {
    const jsonObject = await _loadAsJson(path);
    if (nistSerializers.confirmNistFormat(jsonObject)) {
      // NIST json file
      const data = await nistSerializers.loadNistFile(path);
      annotations.tracks = data.tracks;
      annotations.groups = data.groups;
      meta.fps = data.fps;
    } else if (DatasetMetaMutableKeys.some((key) => key in jsonObject)) {
      // DIVE Json metadata config file
      merge(meta, pick(jsonObject, DatasetMetaMutableKeys));
      metadataConfig = true;
    } else if (coco.isCocoJson(jsonObject)) {
      const [parsedAnnotations, parsedMeta, cocoWarnings] = await coco.parseFile(path);
      annotations = parsedAnnotations;
      merge(meta, parsedMeta);
      warnings = warnings.concat(cocoWarnings);
    } else {
      // Regular dive json
      annotations = await loadAnnotationFile(path);
    }
  } else if (CsvFileName.test(path)) {
    // VIAME CSV File
    const data = await viameSerializers.parseFile(path, imageMap);
    annotations.tracks = data[0].tracks;
    annotations.groups = data[0].groups;
    meta.fps = data[0].fps;
    meta.execTime = data[0].execTime;
    if (data[0].datasetInfo) {
      meta.datasetInfo = data[0].datasetInfo;
    }
    [, warnings] = data;
  } else if (YAMLFileName.test(path)) {
    annotations = await kpf.parse([path]);
  }
  // If it is additive we need to re-ID tracks and do additive prepends
  if (additive) {
    // Load previous data
    const existing = await loadDetections(settings, datasetId);
    const { tracks } = existing;
    let maxTrackId = -1;
    Object.values(tracks).forEach((item) => {
      maxTrackId = Math.max(item.id, maxTrackId);
    });
    maxTrackId += 1;
    const newTracks = Object.values(annotations.tracks);
    for (let i = 0; i < newTracks.length; i += 1) {
      const newTrack = newTracks[i];
      newTrack.id += maxTrackId;
      if (additivePrepend !== '') {
        const { confidencePairs } = newTrack;
        for (let k = 0; k < confidencePairs.length; k += 1) {
          confidencePairs[k] = [`${additivePrepend}_${confidencePairs[k][0]}`, confidencePairs[k][1]];
        }
        newTrack.confidencePairs = confidencePairs;
      }
      existing.tracks[newTrack.id] = newTrack;
    }
    annotations.tracks = existing.tracks;
  }

  if (Object.values(annotations.tracks).length || Object.values(annotations.groups).length) {
    const processed = processTrackAttributes(Object.values(annotations.tracks));
    meta.attributes = processed.attributes;
  }
  if (!metadataConfig) { // Only save Annotations when not a metadata Config file
    await _saveSerialized(settings, datasetId, annotations, true);
  }

  return [meta, warnings];
}

/**
 * ingestDataFiles imports data from external annotation formats
 * given a list of candidate file paths.
 *
 * SUPPORTED FORMATS:
 * VIAME CSV
 *
 * @param paths paths to possible input annotation files
 * @param datasetId dataset id path
 * @param absPaths list of paths to check for annotation files
 * @param multiCamResults Objec where the keys are Camera names
 * and the value is the path to a result file
 */
async function ingestDataFiles(
  settings: Settings,
  datasetId: string,
  absPaths: string[],
  multiCamResults?: Record<string, string>,
  imageMap?: Map<string, number>,
  additive = false,
  additivePrepend = '',
): Promise<{
  processedFiles: string[];
  meta: DatasetMetaMutable & { fps?: number };
  warnings: string[];
}> {
  const processedFiles = []; // which files were processed to generate the detections
  const meta = {};
  let outwarnings: string[] = [];
  for (let i = 0; i < absPaths.length; i += 1) {
    const path = absPaths[i];
    // eslint-disable-next-line no-await-in-loop
    const results = await _ingestFilePath(settings, datasetId, path, imageMap, additive, additivePrepend);
    if (results !== null) {
      const [newMeta, warnings] = results;
      outwarnings = warnings;
      merge(meta, newMeta);
      processedFiles.push(path);
    }
  }
  // processing of multiCam results
  if (multiCamResults) {
    const cameraAndPath = Object.entries(multiCamResults);
    for (let i = 0; i < cameraAndPath.length; i += 1) {
      const cameraName = cameraAndPath[i][0];
      const path = cameraAndPath[i][1];
      const cameraDatasetId = `${datasetId}/${cameraName}`;
      // eslint-disable-next-line no-await-in-loop
      const results = await _ingestFilePath(settings, cameraDatasetId, path, imageMap);
      if (results !== null) {
        const [newMeta, warnings] = results;
        outwarnings = outwarnings.concat(warnings);
        merge(meta, newMeta);
        processedFiles.push(path);
      }
    }
  }

  return { processedFiles, meta, warnings: outwarnings };
}
/**
 * Need to take the trained pipeline if it exists and place it in the DIVE_Pipelines folder
 */
async function processTrainedPipeline(settings: Settings, args: RunTraining, workingDir: string) {
  //Look for trained_detector.zip and detector.pipe and move them to DIVE_Pipelines folder
  const allowedPatterns = /^detector.+|^tracker.+|^generate.+/;
  const trainedDir = npath.join(workingDir, '/category_models');
  const exists = await fs.pathExists(trainedDir);
  if (!exists) {
    throw new Error(`Path: ${trainedDir} does not exist`);
  }
  const folderContents = await fs.readdir(trainedDir);
  const pipes = folderContents.filter((p) => p.match(allowedPatterns));

  if (!pipes.length) {
    throw new Error(`Could not located trained pipe file inside of ${trainedDir}`);
  }
  const baseFolder = npath.join(settings.dataPath, PipelinesFolderName);
  if (!fs.existsSync(baseFolder)) {
    await fs.mkdir(baseFolder);
  }

  const folderName = npath.join(baseFolder, args.pipelineName);
  if (!fs.existsSync(folderName)) {
    await fs.mkdir(folderName);
  }
  //Move detector and model to the new folder
  await Promise.all(folderContents.map(async (item) => {
    const abspath = npath.join(trainedDir, item);
    const destpath = npath.join(folderName, item);
    await fs.move(abspath, destpath, { overwrite: true });
  }));
  return folderContents;
}

async function _initializeAppDataDir(settings: Settings) {
  await fs.ensureDir(settings.dataPath);
  await fs.ensureDir(npath.join(settings.dataPath, ProjectsFolderName));
  await fs.ensureDir(npath.join(settings.dataPath, JobsFolderName));
}

/**
 * Initialize a new project directory
 * @returns absolute path to new project directory
 */
async function _initializeProjectDir(settings: Settings, jsonMeta: JsonMeta): Promise<string> {
  const projectDir = npath.join(settings.dataPath, ProjectsFolderName, jsonMeta.id);
  await _initializeAppDataDir(settings);
  await fs.ensureDir(projectDir);
  return projectDir;
}

async function deleteDataset(
  settings: Settings,
  datasetId: string,
): Promise<boolean> {
  // Confirm dataset exists
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  const projectMetaData = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  await fs.remove(projectDirInfo.basePath);
  // If the dataset source is inside DIVE_Jobs_Output, delete that output folder
  if (projectMetaData.originalBasePath) {
    const jobsOutputPath = npath.resolve(settings.dataPath, JobsOutputFolderName);
    const originalBasePath = npath.resolve(projectMetaData.originalBasePath);
    const isInsideJobsOutput = originalBasePath !== jobsOutputPath
      && originalBasePath.startsWith(jobsOutputPath + npath.sep);
    if (isInsideJobsOutput && await fs.pathExists(originalBasePath)) {
      await fs.remove(originalBasePath);
    }
  }

  return true;
}

async function checkDataset(
  settings: Settings,
  datasetId: string,
): Promise<boolean> {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  const projectMetaData = await loadJsonMetadata(projectDirData.metaFileAbsPath);
  if (projectMetaData.originalBasePath !== '') {
    const exists = await fs.pathExists(projectMetaData.originalBasePath);
    if (!exists) {
      throw new Error(`Dataset ${projectMetaData.name} does not contain source files at ${projectMetaData.originalBasePath}`);
    }
  }
  if (projectMetaData.error && projectMetaData.error !== '') {
    throw new Error(`Dataset ${projectMetaData.name} contains error: ${projectMetaData.error}`);
  }
  return true;
}

async function findTrackandMetaFileinFolder(path: string) {
  const results = await _findJsonAndMetaTrackFile(path);
  let { trackFileAbsPath } = results;
  const { metaFileAbsPath } = results;
  if (!trackFileAbsPath) {
    const csvFileCandidates = await _findCSVTrackFiles(path);
    if (csvFileCandidates.length) {
      [trackFileAbsPath] = csvFileCandidates;
    }
  }
  return { trackFileAbsPath, metaFileAbsPath };
}

/**
 * List immediate child directories of a parent folder (for multicam subfolder import).
 */
async function listImmediateSubfolders(parentPath: string): Promise<string[]> {
  if (!await fs.pathExists(parentPath)) {
    throw new Error(`Directory not found: ${parentPath}`);
  }
  const stat = await fs.stat(parentPath);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${parentPath}`);
  }
  const children = await fs.readdir(parentPath, { withFileTypes: true });
  return children
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
}

function isVideoFilePath(filePath: string): boolean {
  const mimetype = mime.lookup(filePath);
  if (mimetype && (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype))) {
    return true;
  }
  const ext = npath.extname(filePath).replace(/^\./, '').toLowerCase();
  return fileVideoTypes.includes(ext);
}

/**
 * Return true when a subfolder contains at least one importable image or video file.
 */
async function subfolderContainsMedia(
  subfolderPath: string,
  mediaType: 'image-sequence' | 'video',
): Promise<boolean> {
  if (!await fs.pathExists(subfolderPath)) {
    return false;
  }
  const stat = await fs.stat(subfolderPath);
  if (!stat.isDirectory()) {
    return mediaType === 'video' && isVideoFilePath(subfolderPath);
  }
  if (mediaType === 'image-sequence') {
    const found = await findImagesInFolder(subfolderPath);
    return found.imagePaths.length > 0;
  }
  const entries = await fs.readdir(subfolderPath, { withFileTypes: true });
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry.isFile()) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const fullPath = npath.join(subfolderPath, entry.name);
    if (isVideoFilePath(fullPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Discover cameras under a parent folder: immediate subfolders, or separate video files
 * in the parent when importing video and there are no subfolders.
 * Subfolders without importable media (e.g. calibration or transform data) are skipped.
 */
async function listParentFolderCameras(
  parentPath: string,
  mediaType: 'image-sequence' | 'video',
): Promise<{ name: string; sourcePath: string }[]> {
  const subfolders = await listImmediateSubfolders(parentPath);
  const separator = parentPath.includes('\\') ? '\\' : '/';
  const normalized = parentPath.replace(/[\\/]+$/, '');
  const mediaSubfolders: string[] = [];
  for (let i = 0; i < subfolders.length; i += 1) {
    const name = subfolders[i];
    const fullPath = `${normalized}${separator}${name}`;
    // eslint-disable-next-line no-await-in-loop
    if (await subfolderContainsMedia(fullPath, mediaType)) {
      mediaSubfolders.push(name);
    }
  }
  if (mediaSubfolders.length >= 2) {
    return mediaSubfolders.map((name) => ({
      name,
      sourcePath: `${normalized}${separator}${name}`,
    }));
  }
  if (mediaType === 'video' && mediaSubfolders.length === 0) {
    const children = await fs.readdir(parentPath, { withFileTypes: true });
    const videoPaths: string[] = [];
    children.forEach((entry) => {
      if (!entry.isFile()) {
        return;
      }
      const fullPath = npath.join(parentPath, entry.name);
      if (isVideoFilePath(fullPath)) {
        videoPaths.push(fullPath);
      }
    });
    videoPaths.sort((a, b) => a.localeCompare(b));
    return videoPaths.map((fullPath) => ({
      name: npath.parse(fullPath).name,
      sourcePath: fullPath,
    }));
  }
  return mediaSubfolders.map((name) => ({
    name,
    sourcePath: `${normalized}${separator}${name}`,
  }));
}

/**
 * Resolve the import path for one camera subfolder (directory or first video file).
 */
async function resolveMulticamCameraSourcePath(
  subfolderPath: string,
  mediaType: 'image-sequence' | 'video',
): Promise<string> {
  if (mediaType === 'image-sequence') {
    return subfolderPath;
  }
  const stat = await fs.stat(subfolderPath);
  if (!stat.isDirectory()) {
    return subfolderPath;
  }
  const entries = await fs.readdir(subfolderPath, { withFileTypes: true });
  const videoPaths: string[] = [];
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) {
      return;
    }
    const fullPath = npath.join(subfolderPath, entry.name);
    const mimetype = mime.lookup(fullPath);
    if (mimetype && (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype))) {
      videoPaths.push(fullPath);
    }
  }));
  videoPaths.sort((a, b) => a.localeCompare(b));
  if (!videoPaths.length) {
    throw new Error(`No video file found in ${subfolderPath}`);
  }
  return videoPaths[0];
}

/**
 * Attempt a media import on the provided path, which may or may not be a valid dataset.
 */
async function attemptMediaImport(path: string) {
  try {
    // Must await here, as otherwise the try/catch isn't correctly executed.
    return await beginMediaImport(path);
  } catch (e) {
    console.warn(
      `*** Failed to import at path "${path}", with message: "${(e as Error).message}".`
      + ' This is expected if this file or directory does not contain a dataset.',
    );
  }

  return undefined;
}

/**
 * Recursively import all datasets in this directory, using a "breadth-first" approach.
 * This function only recurses into a directory if the import of that directory fails.
 */
async function bulkMediaImport(path: string): Promise<DesktopMediaImportResponse[]> {
  const children = await fs.readdir(path, { withFileTypes: true });
  const results: {path: fs.Dirent, result: DesktopMediaImportResponse | undefined}[] = [];

  // Use a for-of loop, to run imports sequentially. If run concurrently, they can fail behind the scenes.
  // eslint-disable-next-line no-restricted-syntax
  for (const dirent of children) {
    // eslint-disable-next-line no-await-in-loop
    const result = await attemptMediaImport(npath.resolve(path, dirent.name));
    results.push({
      path: dirent,
      result,
    });
  }

  // Filter successful imports
  const importResults = results.filter((r) => r.result !== undefined).map((r) => r.result as DesktopMediaImportResponse);

  // If the result was undefined and was a directory, recurse.
  const toRecurse = results.filter((r) => r.result === undefined && r.path.isDirectory());

  // Use a for-of loop, to run imports sequentially. If run concurrently, they can fail behind the scenes.
  // eslint-disable-next-line no-restricted-syntax
  for (const r of toRecurse) {
    // eslint-disable-next-line no-await-in-loop
    const results = await bulkMediaImport(npath.resolve(path, r.path.name));
    importResults.push(...results);
  }

  return importResults;
}

/**
 * Begin a dataset import.
 */
async function beginMediaImport(path: string): Promise<DesktopMediaImportResponse> {
  let datasetType: DatasetType;
  const fileExtension = npath.extname(path).replace(/^\./, '').toLowerCase();
  const isDesktopLargeImage = largeImageDesktopTypes.includes(fileExtension);

  const exists = fs.existsSync(path);
  if (!exists) {
    throw new Error(`file or directory not found: ${path}`);
  }

  const stat = await fs.stat(path);
  if (stat.isDirectory()) {
    datasetType = 'image-sequence';
  } else if (stat.isFile()) {
    const mimetype = mime.lookup(path);
    if (mimetype && mimetype === 'text/plain') {
      datasetType = 'image-sequence';
    } else if (isDesktopLargeImage) {
      datasetType = 'large-image';
    } else {
      datasetType = 'video';
    }
  } else {
    throw new Error('Only regular files and directories are supported');
  }

  const dsName = npath.parse(path).name;

  const _defaultFps = datasetType === 'video' ? 5 : 1;
  const jsonMeta: JsonMeta = {
    version: JsonMetaCurrentVersion,
    type: datasetType,
    id: '', // will be assigned on finalize
    fps: _defaultFps, // adjusted below
    originalFps: _defaultFps, // adjusted below
    originalBasePath: npath.normalize(path),
    originalVideoFile: '',
    createdAt: (new Date()).toString(),
    originalImageFiles: [],
    transcodedVideoFile: '',
    transcodedImageFiles: [],
    name: dsName,
    multiCam: null,
    subType: null,
    confidenceFilters: { default: DefaultConfidence },
  };

  /* TODO: Look for an EXISTING meta.json file to override the above */

  if (datasetType === 'video') {
    // get parent folder, since videos reference a file directly
    jsonMeta.originalBasePath = npath.dirname(path);
  }
  if (datasetType === 'large-image') {
    jsonMeta.originalBasePath = npath.dirname(path);
    jsonMeta.originalLargeImageFile = npath.basename(path);
  }

  /* Path to search for other related data like annotations */
  let relatedDataSearchPath = jsonMeta.originalBasePath;

  /* mediaConvertList is a list of absolute paths of media to convert */
  let mediaConvertList: string[] = [];
  /* Extract and validate media from import path */
  if (jsonMeta.type === 'large-image') {
    // No conversion for large images; tile serving is done on demand via geotiff
  } else if (jsonMeta.type === 'video') {
    jsonMeta.originalVideoFile = npath.basename(path);
    const mimetype = mime.lookup(path);
    if (mimetype) {
      if (websafeImageTypes.includes(mimetype) || otherImageTypes.includes(mimetype)) {
        throw new Error('User chose image file for video import option');
      } else if (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype)) {
        const checkMediaResult = await checkMedia(path);
        if (!checkMediaResult.websafe || otherVideoTypes.includes(mimetype)) {
          mediaConvertList.push(path);
        }
        const newAnnotationFps = (
          // Prevent FPS smaller than 1
          Math.max(1, Math.min(jsonMeta.fps, checkMediaResult.originalFps))
        );
        jsonMeta.originalFps = checkMediaResult.originalFps;
        jsonMeta.fps = newAnnotationFps;
      } else {
        throw new Error(`unsupported MIME type for video ${mimetype}`);
      }
    } else {
      throw new Error(`could not determine video MIME type for ${path}`);
    }
  } else if (datasetType === 'image-sequence') {
    const found = await findImagesInFolder(path);
    if (found.imagePaths.length === 0) {
      throw new Error(`no images found in ${path}`);
    }
    if (found.source === 'directory') {
      jsonMeta.originalImageFiles = found.imageNames;
    } else if (found.source === 'image-list') {
      jsonMeta.originalImageFiles = found.imagePaths;
      jsonMeta.imageListPath = npath.normalize(path);
      jsonMeta.originalBasePath = '';
      jsonMeta.name = npath.basename(npath.dirname(path));
      relatedDataSearchPath = npath.dirname(path);
    }
    mediaConvertList = found.mediaConvertList;
  } else if (datasetType !== 'large-image') {
    throw new Error('only video, image-sequence, and large-image types are supported');
  }

  const { trackFileAbsPath, metaFileAbsPath } = await
  findTrackandMetaFileinFolder(relatedDataSearchPath);
  return {
    jsonMeta,
    globPattern: '',
    mediaConvertList,
    trackFileAbsPath,
    forceMediaTranscode: false,
    useNativePlayback: false,
    multiCamTrackFiles: null,
    metaFileAbsPath,
  };
}

function validImageNamesMap(jsonMeta: JsonMeta) {
  if (jsonMeta.originalImageFiles.length > 0) {
    const imageMap = new Map<string, number>();
    jsonMeta.originalImageFiles.forEach((imgPath, i) => {
      const [imageBaseName] = splitExt(imgPath);
      if (imageMap.get(imageBaseName) !== undefined) {
        throw new Error([
          `An image named ${imageBaseName} was found twice in the dataset,`,
          'probably in different folders. DIVE cannot handle this case.',
          'Please contact support.',
        ].join(' '));
      }
      imageMap.set(imageBaseName, i);
    });
    return imageMap;
  }
  return undefined;
}

async function dataFileImport(settings: Settings, id: string, path: string, additive = false, additivePrepend = '') {
  const projectDirData = await getValidatedProjectDir(settings, id);
  const jsonMeta = await loadJsonMetadata(projectDirData.metaFileAbsPath);
  const existingDatasetInfo = jsonMeta.datasetInfo;
  const result = await ingestDataFiles(
    settings,
    id,
    [path],
    undefined,
    validImageNamesMap(jsonMeta),
    additive,
    additivePrepend,
  );
  merge(jsonMeta, result.meta);
  // Assign datasetInfo explicitly; the deep-merge above would keep keys an Overwrite
  // import meant to drop. Like the server, Overwrite replaces the block wholesale while
  // an additive import merges per-key (imported values win).
  if (result.meta.datasetInfo) {
    jsonMeta.datasetInfo = additive
      ? { ...(existingDatasetInfo ?? {}), ...result.meta.datasetInfo }
      : result.meta.datasetInfo;
  }
  await _saveAsJson(npath.join(projectDirData.basePath, JsonMetaFileName), jsonMeta);
  return result;
}

async function _importTrackFile(
  settings: Settings,
  dsId: string,
  projectDirAbsPath: string,
  jsonMeta: JsonMeta,
  userTrackFileAbsPath: string,
) {
  /* custom image sort */
  if (jsonMeta.imageListPath === undefined) {
    jsonMeta.originalImageFiles.sort(strNumericCompare);
  }
  if (jsonMeta.transcodedImageFiles) {
    jsonMeta.transcodedImageFiles.sort(strNumericCompare);
  }
  if (userTrackFileAbsPath) {
    const processed = await ingestDataFiles(settings, dsId, [userTrackFileAbsPath], undefined, validImageNamesMap(jsonMeta));
    merge(jsonMeta, processed.meta);
    if (processed.processedFiles.length === 0) {
      await _saveSerialized(settings, dsId, dive.makeEmptyAnnotationFile(), true);
    }
  } else {
    await _saveSerialized(settings, dsId, dive.makeEmptyAnnotationFile(), true);
  }
  await _saveAsJson(npath.join(projectDirAbsPath, JsonMetaFileName), jsonMeta);
  return jsonMeta;
}

/**
 * After media conversion we need to remove the transcodingKey to signify it is done
 */
export async function completeConversion(settings: Settings, datasetId: string, transcodingJobKey: string, meta: JsonMeta) {
  await getValidatedProjectDir(settings, datasetId);
  if (meta.transcodingJobKey === transcodingJobKey) {
    // eslint-disable-next-line no-param-reassign
    meta.transcodingJobKey = undefined;
    saveMetadata(settings, datasetId, meta);
  }
}

export async function failConversion(settings: Settings, datasetId: string, meta: JsonMeta, errorMessage: string) {
  await getValidatedProjectDir(settings, datasetId);
  // eslint-disable-next-line no-param-reassign
  meta.error = errorMessage;
  saveMetadata(settings, datasetId, meta);
}

/**
 * Finalize a dataset import.
 */
async function finalizeMediaImport(
  settings: Settings,
  args: DesktopMediaImportResponse,
): Promise<ConversionArgs> {
  const { jsonMeta, globPattern } = args;
  let { mediaConvertList } = args;
  const { type: datasetType } = jsonMeta;
  jsonMeta.id = `${cleanString(jsonMeta.name).substr(0, 20)}_${makeid(10)}`;
  const projectDirAbsPath = await _initializeProjectDir(settings, jsonMeta);

  // Store any stereo calibration / camera file alongside the media and normalize
  // it to the VIAME JSON camera-rig format (keeping the original).
  if (jsonMeta.multiCam?.calibration) {
    const calibrationSourcePath = npath.resolve(jsonMeta.multiCam.calibration);
    const preservedOriginalPath = npath.join(
      projectDirAbsPath,
      npath.basename(calibrationSourcePath),
    );
    jsonMeta.multiCam.calibrationOriginalName = realCalibrationName(calibrationSourcePath);
    jsonMeta.multiCam.calibration = await prepareDatasetCalibration(
      settings,
      projectDirAbsPath,
      calibrationSourcePath,
    );
    jsonMeta.multiCam.calibrationSourcePath = preservedOriginalPath;
  }

  // Store any optional metadata file alongside the media (keeping the original
  // name). Single imports pass it on the response; multicam imports stash the
  // source path on jsonMeta.metadataFile during beginMultiCamImport.
  const metadataSourcePath = args.metadataFileAbsPath || jsonMeta.metadataFile;
  if (metadataSourcePath) {
    const resolvedMetadataSource = npath.resolve(metadataSourcePath);
    const metadataDest = npath.join(
      projectDirAbsPath,
      npath.basename(resolvedMetadataSource),
    );
    await fs.copy(resolvedMetadataSource, metadataDest);
    jsonMeta.metadataOriginalName = npath.basename(resolvedMetadataSource);
    jsonMeta.metadataFile = metadataDest;
  } else {
    // Ensure a stale source path never survives when no file was chosen.
    jsonMeta.metadataFile = undefined;
    jsonMeta.metadataOriginalName = undefined;
  }

  // Filter all parts of the input based on glob pattern
  if (globPattern && jsonMeta.type === 'image-sequence') {
    const searchPath = jsonMeta.imageListPath || jsonMeta.originalBasePath;
    const found = await findImagesInFolder(searchPath, globPattern);
    if (found.imageNames.length === 0) {
      throw new Error(`no images in ${searchPath} matched pattern ${globPattern}`);
    }
    if (found.source === 'directory') {
      jsonMeta.originalImageFiles = found.imageNames;
    } else if (found.source === 'image-list') {
      jsonMeta.originalImageFiles = found.imagePaths;
    }
    mediaConvertList = found.mediaConvertList;
  }

  if (jsonMeta.type === 'video') {
    // Verify that the user didn't choose an FPS value higher than originalFPS
    // This shouldn't be possible in the UI, but we should still prevent it here.
    jsonMeta.fps = (
      Math.max(1, Math.min(jsonMeta.fps, jsonMeta.originalFps))
    );

    // If using native playback, skip conversion entirely
    if (args.useNativePlayback) {
      jsonMeta.useNativePlayback = true;
      // Clear any conversion list for videos when using native playback
      mediaConvertList = [];
    } else if (args.forceMediaTranscode) {
      mediaConvertList.push(npath.join(jsonMeta.originalBasePath, jsonMeta.originalVideoFile));
    }
  }

  // Determine which files, if any, need to be queued for conversion. Consumers
  // of this function are responsible for starting the conversion.
  const srcDstList: [string, string][] = [];
  if (mediaConvertList.length) {
    const extension = datasetType === 'video' ? '.mp4' : '.png';
    let destAbsPath = '';
    mediaConvertList.forEach((absPath) => {
      const filename = npath.basename(absPath);
      const destLoc = npath.join(projectDirAbsPath, filename);
      //If we have multicam we may need to check more than the base folder
      if (datasetType === MultiType) {
        destAbsPath = transcodeMultiCam(jsonMeta, absPath, projectDirAbsPath);
      } else {
        destAbsPath = destLoc.replace(npath.extname(absPath), extension);
        if (datasetType === 'video') {
          jsonMeta.transcodedVideoFile = npath.basename(destAbsPath);
        } else if (datasetType === 'image-sequence') {
          if (!jsonMeta.transcodedImageFiles) {
            jsonMeta.transcodedImageFiles = [];
          }
          jsonMeta.transcodedImageFiles.push(npath.basename(destAbsPath));
        }
      }
      srcDstList.push([absPath, destAbsPath]);
    });
  }

  //We need to create datasets for each of the multiCam folders as well
  if (datasetType === MultiType && jsonMeta.multiCam?.cameras) {
    const cameraNameAndData = Object.entries(jsonMeta.multiCam.cameras);
    for (let i = 0; i < cameraNameAndData.length; i += 1) {
      const cameraName = cameraNameAndData[i][0];
      const cameraData = cameraNameAndData[i][1];

      const jsonClone = { ...cloneDeep(jsonMeta), ...cameraData };
      jsonClone.multiCam = null;
      jsonClone.id = `${jsonMeta.id}/${cameraName}`;
      jsonClone.transcodedVideoFile = cameraData.transcodedVideoFile || '';
      jsonClone.transcodedImageFiles = cameraData.transcodedImageFiles || [];
      jsonClone.subType = null;
      // eslint-disable-next-line no-await-in-loop
      const cameraDirAbsPath = await _initializeProjectDir(settings, jsonClone);
      let multiCamTrackFile = '';
      if (args.multiCamTrackFiles && args.multiCamTrackFiles[cameraName]) {
        multiCamTrackFile = args.multiCamTrackFiles[cameraName];
      }
      // eslint-disable-next-line no-await-in-loop
      await _importTrackFile(settings, jsonClone.id, cameraDirAbsPath, jsonClone, multiCamTrackFile);
    }
  }
  const finalJsonMeta = await _importTrackFile(settings, jsonMeta.id, projectDirAbsPath, jsonMeta, args.trackFileAbsPath);
  if (args.metaFileAbsPath) {
    await dataFileImport(settings, jsonMeta.id, args.metaFileAbsPath);
  }
  const conversionJobArgs: ConversionArgs = {
    type: JobType.Conversion,
    meta: finalJsonMeta,
    mediaList: srcDstList,
  };
  return conversionJobArgs;
}

/**
 * Get the absolute path to the large image (e.g. GeoTIFF) file for a dataset.
 * Returns null if the dataset is not type 'large-image' or path is missing.
 */
async function getLargeImagePath(settings: Settings, datasetId: string): Promise<string | null> {
  try {
    const projectDirData = await getValidatedProjectDir(settings, datasetId);
    const meta = await loadJsonMetadata(projectDirData.metaFileAbsPath);
    if (meta.type !== 'large-image' || !meta.originalLargeImageFile) {
      console.warn(
        `[tiles] getLargeImagePath: no path for dataset "${datasetId}" (meta.type=${meta.type}, hasOriginalLargeImageFile=${!!meta.originalLargeImageFile})`,
      );
      return null;
    }
    const path = npath.join(meta.originalBasePath, meta.originalLargeImageFile);
    return path;
  } catch (err) {
    console.warn(`[tiles] getLargeImagePath: error for dataset "${datasetId}":`, err);
    return null;
  }
}

/**
 * Resolve the absolute path of the ORIGINAL (pre-transcode) image for a frame.
 *
 * The percentile-stretch / display path must read the original source image
 * (e.g. a 16-bit IR TIFF), NOT the 8-bit PNG produced by import-time transcoding
 * (`transcodedImageFiles`), which has already discarded the dynamic range the
 * stretch is meant to recover. `imageData` URLs sent to the client point at the
 * transcoded copies, so the client passes a frame index and we map it back to
 * the original here. Returns null if the frame is out of range or unavailable.
 */
async function getDisplayImagePath(
  settings: Settings,
  datasetId: string,
  frame: number,
): Promise<string | null> {
  try {
    const projectDirData = await getValidatedProjectDir(settings, datasetId);
    const meta = await loadJsonMetadata(projectDirData.metaFileAbsPath);
    const originals = meta.originalImageFiles ?? [];
    if (!Number.isInteger(frame) || frame < 0 || frame >= originals.length) {
      console.warn(
        `[display] getDisplayImagePath: frame ${frame} out of range for dataset "${datasetId}" (${originals.length} images)`,
      );
      return null;
    }
    const entry = originals[frame];
    // originalImageFiles entries are relative to originalBasePath, except for
    // image-list imports where they are absolute and originalBasePath is ''.
    return npath.isAbsolute(entry) ? entry : npath.join(meta.originalBasePath, entry);
  } catch (err) {
    console.warn(`[display] getDisplayImagePath: error for dataset "${datasetId}":`, err);
    return null;
  }
}

async function openLink(url: string) {
  shell.openExternal(url);
}

/**
 * Open a file or folder in the system file manager.
 * Returns an empty string on success or an error message on failure.
 *
 * shell.openPath can hang indefinitely on Linux (never resolving its promise),
 * which breaks ipcMain.handle callers. Files use showItemInFolder; directories
 * use a detached platform opener so the IPC handler always replies promptly.
 */
async function openPathInFileManager(targetPath: string): Promise<string> {
  if (!targetPath?.trim()) {
    return 'No path specified';
  }
  const resolved = npath.resolve(targetPath.trim());
  if (!(await fs.pathExists(resolved))) {
    return `Path does not exist: ${resolved}`;
  }

  const stat = await fs.stat(resolved);
  if (stat.isFile()) {
    shell.showItemInFolder(resolved);
    return '';
  }

  if (process.platform === 'linux') {
    spawn('xdg-open', [resolved], { detached: true, stdio: 'ignore' }).unref();
    return '';
  }
  if (process.platform === 'win32') {
    spawn('explorer', [resolved], { detached: true, stdio: 'ignore' }).unref();
    return '';
  }
  if (process.platform === 'darwin') {
    spawn('open', [resolved], { detached: true, stdio: 'ignore' }).unref();
    return '';
  }

  return shell.openPath(resolved);
}

async function exportDataset(settings: Settings, args: ExportDatasetArgs) {
  const projectDirInfo = await getValidatedProjectDir(settings, args.id);
  const meta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  const data = await loadAnnotationFile(projectDirInfo.trackFileAbsPath);
  if (args.type === 'json') {
    return dive.serializeFile(args.path, data, meta, args.typeFilter, {
      excludeBelowThreshold: args.exclude,
      header: true,
    });
  }
  if (args.type === 'coco') {
    return coco.serializeFile(args.path, data, meta, args.typeFilter, {
      excludeBelowThreshold: args.exclude,
    });
  }
  return viameSerializers.serializeFile(args.path, data, meta, args.typeFilter, {
    excludeBelowThreshold: args.exclude,
    header: true,
  });
}

async function exportConfiguration(settings: Settings, args: ExportConfigurationArgs) {
  const projectDirInfo = await getValidatedProjectDir(settings, args.id);
  const meta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  const output: DatasetMetaMutable & { version: number} = { version: meta.version };
  if (DatasetMetaMutableKeys.some((key) => key in meta)) {
    // DIVE Json metadata config file
    merge(output, pick(meta, DatasetMetaMutableKeys));
  }
  await fs.writeJSON(args.path, output);
  return args.path;
}

export {
  ProjectsFolderName,
  JobsFolderName,
  autodiscoverData,
  bulkMediaImport,
  beginMediaImport,
  dataFileImport,
  deleteDataset,
  checkDataset,
  exportConfiguration,
  exportDataset,
  finalizeMediaImport,
  getPipelineList,
  deleteTrainedPipeline,
  getTrainingConfigs,
  getProjectDir,
  getValidatedProjectDir,
  getLargeImagePath,
  getDisplayImagePath,
  loadMetadata,
  loadJsonMetadata,
  loadAnnotationFile,
  loadDetections,
  openLink,
  openPathInFileManager,
  ingestDataFiles,
  saveDetections,
  saveMetadata,
  processTrainedPipeline,
  saveAttributes,
  saveAttributeTrackFilters,
  findImagesInFolder,
  listImmediateSubfolders,
  listParentFolderCameras,
  resolveMulticamCameraSourcePath,
  findTrackandMetaFileinFolder,
};

export {
  fromRegistrationPairs,
  findParentFolderTransformFiles,
  exportCameraRegistration,
  importCameraRegistration,
} from './cameraRegistration';

export {
  findParentFolderCalibrationFile,
  getLastCalibrationPath,
  saveLastCalibration,
  applyCalibrationToUncalibratedStereoDatasets,
  datasetHasCalibrationFile,
  getDatasetCalibrationPath,
  getDatasetCalibrationExportPath,
  setDatasetCalibration,
  exportDatasetCalibration,
  getDatasetCalibration,
  deleteDatasetCalibration,
} from './datasetCalibration';

export { exportMulticamEverything } from './multicamExport';
