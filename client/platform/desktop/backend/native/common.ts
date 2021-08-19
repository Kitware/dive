/**
 * Common native implementations
 */

import npath from 'path';
import fs from 'fs-extra';
import { shell } from 'electron';
import mime from 'mime-types';
import moment from 'moment';
import lockfile from 'proper-lockfile';
import {
  DatasetType, MultiTrackRecord, Pipelines, SaveDetectionsArgs,
  FrameImage, DatasetMetaMutable, TrainingConfigs, SaveAttributeArgs,
  MultiCamMedia,
} from 'dive-common/apispec';
import * as viameSerializers from 'platform/desktop/backend/serializers/viame';
import {
  websafeImageTypes, websafeVideoTypes, otherImageTypes, otherVideoTypes,
} from 'dive-common/constants';
import {
  JsonMeta, Settings, JsonMetaCurrentVersion, DesktopMetadata, DesktopJobUpdater,
  ConvertMedia, RunTraining, ExportDatasetArgs, MediaImportPayload, CheckMediaResults,
} from 'platform/desktop/constants';
import {
  cleanString, filterByGlob, makeid, strNumericCompare,
} from 'platform/desktop/sharedUtils';
import { Attribute, Attributes } from 'vue-media-annotator/use/useAttributes';
import { cloneDeep } from 'lodash';
import processTrackAttributes from './attributeProcessor';
import { upgrade } from './migrations';
import { getMultiCamUrls, transcodeMultiCam } from './multiCamUtils';

const ProjectsFolderName = 'DIVE_Projects';
const JobsFolderName = 'DIVE_Jobs';
const PipelinesFolderName = 'DIVE_Pipelines';

const AuxFolderName = 'auxiliary';

const JsonTrackFileName = /^result(_.*)?\.json$/;
const JsonMetaFileName = 'meta.json';
const CsvFileName = /^.*\.csv$/;

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
    mediaConvertList: requiresTranscoding
      ? images.map((filename) => npath.join(path, filename))
      : [],
  };
}

async function _acquireLock(dir: string, resource: string, lockname: 'meta' | 'tracks') {
  const release = await lockfile.lock(resource, {
    stale: 5000, // 5 seconds
    lockfilePath: npath.join(dir, `${lockname}.lock`),
  });
  return release;
}


async function _findCSVTrackFiles(originalBasePath: string) {
  const contents = await fs.readdir(originalBasePath);
  const csvFileCandidates = contents
    .filter((v) => CsvFileName.test(v))
    .map((filename) => npath.join(originalBasePath, filename));
  return csvFileCandidates;
}

/**
 * locate json track file in a directory
 * @param path path to a directory
 * @returns absolute path to json file or empty string
 */
async function _findJsonTrackFile(basePath: string): Promise<string> {
  const contents = await fs.readdir(basePath);
  const jsonFileCandidates: string[] = [];
  await Promise.all(contents.map(async (name) => {
    if (JsonTrackFileName.test(name)) {
      const fullPath = npath.join(basePath, name);
      const statResult = await fs.stat(fullPath);
      if (statResult.isFile()) {
        jsonFileCandidates.push(fullPath);
      }
    }
  }));
  if (jsonFileCandidates.length > 0) {
    return jsonFileCandidates[0];
  }
  return '';
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
  const trackFileAbsPath = await _findJsonTrackFile(projectInfo.basePath);
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
  const rawBuffer = await fs.readFile(metaAbsPath, 'utf-8');
  let metaJson;
  try {
    metaJson = JSON.parse(rawBuffer);
  } catch (err) {
    throw new Error(`Unable to parse ${metaAbsPath}: ${err}`);
  }
  /* check if this file meets the current schema version */
  upgrade(metaJson);
  return metaJson as JsonMeta;
}

/**
 * loadJsonTracks load from file
 * @param tracksPath a known, existing path
 */
async function loadJsonTracks(tracksAbsPath: string): Promise<MultiTrackRecord> {
  const rawBuffer = await fs.readFile(tracksAbsPath, 'utf-8');
  if (rawBuffer.length === 0) {
    return {}; // Return empty object if file was empty
  }
  let annotationData: MultiTrackRecord = {};
  try {
    annotationData = JSON.parse(rawBuffer) as MultiTrackRecord;
  } catch (err) {
    throw new Error(`Unable to parse ${tracksAbsPath}: ${err}`);
  }
  // TODO: somehow verify the schema of this file
  if (Array.isArray(annotationData)) {
    throw new Error('object expected in track json');
  }
  return annotationData;
}

async function loadMetadata(
  settings: Settings,
  datasetId: string,
  makeMediaUrl: (path: string) => string,
): Promise<DesktopMetadata> {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  const projectMetaData = await loadJsonMetadata(projectDirData.metaFileAbsPath);

  let videoUrl = '';
  let imageData = [] as FrameImage[];
  let multiCamMedia: MultiCamMedia | null = null;
  const { subType } = projectMetaData;
  /* Generate URLs against embedded media server from known file paths on disk */
  if (projectMetaData.type === 'multi') {
    // Returns the type of the defaultDisplay for the multicam
    if (!projectMetaData.multiCam) {
      throw new Error(`Dataset: ${projectMetaData.name} is of type multiCam or stereo but contains no multiCam data`);
    }
    multiCamMedia = getMultiCamUrls(
      projectMetaData, projectDirData.basePath, makeMediaUrl,
    );
    /* TODO: Done temporarily before we support true display of items */
    const defaultDisplay = multiCamMedia.cameras[multiCamMedia.defaultDisplay];
    imageData = defaultDisplay.imageData;
    videoUrl = defaultDisplay.videoUrl;
  } else if (projectMetaData.type === 'video') {
    /* If the video has been transcoded, use that video */
    if (projectMetaData.transcodedVideoFile) {
      const video = npath.join(projectDirData.basePath, projectMetaData.transcodedVideoFile);
      videoUrl = makeMediaUrl(video);
    } else {
      const video = npath.join(projectMetaData.originalBasePath, projectMetaData.originalVideoFile);
      videoUrl = makeMediaUrl(video);
    }
  } else if (projectMetaData.type === 'image-sequence') {
    if (projectMetaData.transcodedImageFiles && projectMetaData.transcodedImageFiles.length) {
      imageData = projectMetaData.transcodedImageFiles.map((filename: string) => ({
        url: makeMediaUrl(npath.join(projectDirData.basePath, filename)),
        filename,
      }));
    } else {
      imageData = projectMetaData.originalImageFiles.map((filename: string) => ({
        url: makeMediaUrl(npath.join(projectMetaData.originalBasePath, filename)),
        filename,
      }));
    }
  } else {
    throw new Error(`unexpected project type for id="${datasetId}" type="${projectMetaData.type}"`);
  }
  // Redirecting type to image-sequence or video for multi camera types
  return {
    ...projectMetaData,
    videoUrl,
    imageData,
    multiCamMedia,
    subType,
  };
}

async function loadDetections(settings: Settings, datasetId: string) {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  return loadJsonTracks(projectDirData.trackFileAbsPath);
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
  const allowedPatterns = /^detector_.+|^tracker_.+|^generate_.+|^utility_|^measurement_gmm_.+/;
  const disallowedPatterns = /.*local.*|detector_svm_models.pipe|tracker_svm_models.pipe/;
  const exists = await fs.pathExists(pipelinePath);
  if (!exists) return {};
  let pipes = await fs.readdir(pipelinePath);
  pipes = pipes.filter((p) => p.match(allowedPatterns) && !p.match(disallowedPatterns));

  /* TODO: fetch trained pipelines */
  const ret: Pipelines = {};
  pipes.forEach((p) => {
    const parts = cleanString(p.replace('.pipe', '')).split('_');
    const pipeType = parts[0];
    const pipeName = parts.slice(1).join(' ');
    const pipeInfo = {
      name: pipeName,
      type: pipeType,
      pipe: p,
    };
    if (pipeType in ret) {
      ret[pipeType].pipes.push(pipeInfo);
    } else {
      ret[pipeType] = {
        pipes: [pipeInfo],
        description: '',
      };
    }
  });

  // Now lets add to it the trained pipelines by recursively looking in the dir
  const allowedTrainedPatterns = new RegExp([
    '^detector.+',
    '^tracker.+',
    '^generate.+',
    '^.*\\.zip',
    '^.*\\.svm',
    '^.*\\.lbl',
    '^.*\\.cfg',
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

/**
 * get training configurations
 */
async function getTrainingConfigs(settings: Settings): Promise<TrainingConfigs> {
  const pipelinePath = npath.join(settings.viamePath, 'configs/pipelines');
  const allowedPatterns = /\.viame_csv\.conf$/;
  const disallowedPatterns = /.*_nf\.viame_csv\.conf$/;
  const exists = await fs.pathExists(pipelinePath);
  if (!exists) {
    throw new Error('Path does not exist');
  }
  let configs = await fs.readdir(pipelinePath);
  configs = configs
    .filter((p) => (p.match(allowedPatterns) && !p.match(disallowedPatterns)))
    .sort((a, b) => a.localeCompare(b));
  return {
    default: configs[0],
    configs,
  };
}

/**
 * Create job run working directory
 */
async function createKwiverRunWorkingDir(
  settings: Settings, jsonMetaList: JsonMeta[], pipeline: string,
) {
  if (jsonMetaList.length === 0) {
    throw new Error('At least 1 jsonMeta item must be provided');
  }
  const jobFolderPath = npath.join(settings.dataPath, JobsFolderName);
  // eslint won't recognize \. as valid escape
  // eslint-disable-next-line no-useless-escape
  const safeDatasetName = jsonMetaList[0].name.replace(/[\.\s/]+/g, '_');
  const runFolderName = moment().format(`[${safeDatasetName}_${pipeline}]_MM-DD-yy_hh-mm-ss.SSS`);
  const runFolderPath = npath.join(jobFolderPath, runFolderName);
  if (!fs.existsSync(jobFolderPath)) {
    await fs.mkdir(jobFolderPath);
  }
  await fs.mkdir(runFolderPath);
  return runFolderPath;
}

/**
 * _saveSerialized save pre-serialized tracks to disk
 */
async function _saveSerialized(
  settings: Settings,
  datasetId: string,
  trackData: MultiTrackRecord,
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
  const serialized = JSON.stringify(trackData);
  await fs.writeFile(npath.join(projectInfo.basePath, newFileName), serialized);
  await release();
}

/**
 * Save detections to json file in aux
 */
async function saveDetections(settings: Settings, datasetId: string, args: SaveDetectionsArgs) {
  /* Update existing track file */
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  const existing = await loadJsonTracks(projectDirInfo.trackFileAbsPath);
  args.delete.forEach((trackId) => delete existing[trackId.toString()]);
  args.upsert.forEach((track) => {
    existing[track.trackId.toString()] = track;
  });
  return _saveSerialized(settings, datasetId, existing);
}

/**
 * _saveAsJson saves directly to disk
 */
async function _saveAsJson(absPath: string, data: unknown) {
  const serialized = JSON.stringify(data, null, 2);
  await fs.writeFile(absPath, serialized);
}

async function saveMetadata(settings: Settings, datasetId: string,
  args: DatasetMetaMutable & { attributes?: Record<string, Attribute> }) {
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  const release = await _acquireLock(projectDirInfo.basePath, projectDirInfo.metaFileAbsPath, 'meta');
  const existing = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  if (args.confidenceFilters) {
    existing.confidenceFilters = args.confidenceFilters;
  }
  if (args.customTypeStyling) {
    existing.customTypeStyling = args.customTypeStyling;
  }
  if (args.attributes) {
    existing.attributes = args.attributes;
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


async function processAnnotationFilePath(
  settings: Settings,
  datasetId: string,
  path: string,
) {
  if (!fs.existsSync(path)) {
    return {};
  }
  if (fs.statSync(path).size > 0) {
    // Attempt to process the file
    try {
      // eslint-disable-next-line no-await-in-loop
      const data = await viameSerializers.parseFile(path);
      const processed = processTrackAttributes(data.tracks);
      const { fps } = data;
      const { attributes } = processed;
      // eslint-disable-next-line no-await-in-loop
      await _saveSerialized(settings, datasetId, processed.data, true);
      return {
        fps, attributes, path,
      };
    } catch (err) {
      // eslint-disable-next-line no-continue
    }
    return {};
  }
  return { };
}
/**
 * processOtherAnnotationFiles imports data from external annotation formats
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
async function processOtherAnnotationFiles(
  settings: Settings,
  datasetId: string,
  absPaths: string[],
  multiCamResults?: Record<string, string>,
): Promise<{ fps?: number; processedFiles: string[]; attributes?: Attributes }> {
  let fps: number | undefined;
  const processedFiles = []; // which files were processed to generate the detections
  let attributes: Attributes = {};

  for (let i = 0; i < absPaths.length; i += 1) {
    const path = absPaths[i];
    // eslint-disable-next-line no-await-in-loop
    const result = await processAnnotationFilePath(settings, datasetId, path);
    if (result.fps) {
      fps = fps || result.fps;
    }
    if (result.attributes) {
      attributes = result.attributes;
    }
    if (result.path) {
      processedFiles.push(result.path);
    }
  }
  //Processing of multiCam results:
  if (multiCamResults) {
    const cameraAndPath = Object.entries(multiCamResults);
    for (let i = 0; i < cameraAndPath.length; i += 1) {
      const cameraName = cameraAndPath[i][0];
      const path = cameraAndPath[i][1];
      const cameraDatasetId = `${datasetId}/${cameraName}`;
      // eslint-disable-next-line no-await-in-loop
      const result = await processAnnotationFilePath(settings, cameraDatasetId, path);
      if (result.fps) {
        fps = fps || result.fps;
      }
      if (result.attributes) {
        attributes = result.attributes;
      }
      if (result.path) {
        processedFiles.push(result.path);
      }
    }
  }

  return { fps, processedFiles, attributes };
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
  // confirm dataset Id exists
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  await fs.remove(projectDirInfo.basePath);
  return true;
}

async function checkDataset(
  settings: Settings,
  datasetId: string,
): Promise<boolean> {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  const projectMetaData = await loadJsonMetadata(projectDirData.metaFileAbsPath);
  //Check folder exists for data
  const exists = await fs.pathExists(projectMetaData.originalBasePath);
  if (!exists) {
    throw new Error(`Dataset ${projectMetaData.name} does not contain source files at ${projectMetaData.originalBasePath}`);
  }
  return true;
}


async function findTrackFileinFolder(path: string) {
  let trackFileAbsPath = await _findJsonTrackFile(path);
  if (!trackFileAbsPath) {
    const csvFileCandidates = await _findCSVTrackFiles(path);
    if (csvFileCandidates.length) {
      [trackFileAbsPath] = csvFileCandidates;
    }
  }
  return trackFileAbsPath;
}
/**
 * Begin a dataset import.
 */
async function beginMediaImport(
  settings: Settings,
  path: string,
  checkMedia: (settings: Settings, path: string) => Promise<CheckMediaResults>,
): Promise<MediaImportPayload> {
  let datasetType: DatasetType;

  const exists = fs.existsSync(path);
  if (!exists) {
    throw new Error(`file or directory not found: ${path}`);
  }

  const stat = await fs.stat(path);
  if (stat.isDirectory()) {
    datasetType = 'image-sequence';
  } else if (stat.isFile()) {
    datasetType = 'video';
  } else {
    throw new Error('Only regular files and directories are supported');
  }

  const dsName = npath.parse(path).name;
  const dsId = `${cleanString(dsName).substr(0, 20)}_${makeid(10)}`;

  const _defaultFps = datasetType === 'video' ? 5 : 1;
  const jsonMeta: JsonMeta = {
    version: JsonMetaCurrentVersion,
    type: datasetType,
    id: dsId,
    fps: _defaultFps, // adjusted below
    originalFps: _defaultFps, // adjusted below
    originalBasePath: path,
    originalVideoFile: '',
    createdAt: (new Date()).toString(),
    originalImageFiles: [],
    transcodedVideoFile: '',
    transcodedImageFiles: [],
    name: dsName,
    multiCam: null,
    subType: null,
    confidenceFilters: { default: 0.1 },
  };

  /* TODO: Look for an EXISTING meta.json file to override the above */

  if (datasetType === 'video') {
    // get parent folder, since videos reference a file directly
    jsonMeta.originalBasePath = npath.dirname(path);
  }

  /* mediaConvertList is a list of absolute paths of media to convert */
  let mediaConvertList: string[] = [];
  /* Extract and validate media from import path */
  if (jsonMeta.type === 'video') {
    jsonMeta.originalVideoFile = npath.basename(path);
    const mimetype = mime.lookup(path);
    if (mimetype) {
      if (websafeImageTypes.includes(mimetype) || otherImageTypes.includes(mimetype)) {
        throw new Error('User chose image file for video import option');
      } else if (websafeVideoTypes.includes(mimetype) || otherVideoTypes.includes(mimetype)) {
        const checkMediaResult = await checkMedia(settings, path);
        if (!checkMediaResult.websafe || otherVideoTypes.includes(mimetype)) {
          mediaConvertList.push(path);
        }
        const newAnnotationFps = Math.floor(
          // Prevent FPS smaller than 1
          Math.max(1, Math.min(jsonMeta.fps, checkMediaResult.originalFps)),
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
    const found = await findImagesInFolder(jsonMeta.originalBasePath);
    if (found.images.length === 0) {
      throw new Error(`no images found in ${path}`);
    }
    jsonMeta.originalImageFiles = found.images;
    mediaConvertList = found.mediaConvertList;
  } else {
    throw new Error('only video and image-sequence types are supported');
  }

  const trackFileAbsPath = await findTrackFileinFolder(jsonMeta.originalBasePath);
  return {
    jsonMeta,
    globPattern: '',
    mediaConvertList,
    trackFileAbsPath,
    multiCamTrackFiles: null,
  };
}

async function annotationImport(
  settings: Settings,
  id: string,
  annotationPath: string,
  allowEmpty = true,
) {
  const projectInfo = getProjectDir(settings, id);
  const validatedInfo = await getValidatedProjectDir(settings, id);
  // If it is a json file we need to make sure it has the proper name
  if (JsonTrackFileName.test(npath.basename(annotationPath))) {
    const statResult = await fs.stat(annotationPath);
    if (statResult.isFile()) {
      const release = await _acquireLock(projectInfo.basePath, projectInfo.basePath, 'tracks');
      try {
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
      const time = moment().format('MM-DD-YYYY_hh-mm-ss.SSS');
      const newFileName = `result_${time}.json`;

      const newPath = npath.join(projectInfo.basePath, npath.basename(newFileName));
      await fs.copy(
        annotationPath,
        newPath,
      );
      await release();
      return true;
    }
    return false;
  }
  // If not a JSON we do a process for the CSV
  const newPath = npath.join(projectInfo.basePath, npath.basename(annotationPath));
  await fs.copy(
    annotationPath,
    newPath,
  );
  const results = await processOtherAnnotationFiles(settings, id, [newPath]);
  if (results.processedFiles.length) {
    return true;
  }
  return false;
}

async function _importTrackFile(
  settings: Settings,
  dsId: string,
  projectDirAbsPath: string,
  jsonMeta: JsonMeta,
  userTrackFileAbsPath: string,
) {
  /* Look for JSON track file as first priority */
  let foundDetections = false;

  if (userTrackFileAbsPath && !CsvFileName.test(userTrackFileAbsPath)) {
    /* Move the track file into the new project directory */
    const time = moment().format('MM-DD-YYYY_hh-mm-ss.SSS');
    const newFileName = `result_${time}.json`;

    const newPath = npath.join(projectDirAbsPath, npath.basename(newFileName));

    await fs.copy(
      userTrackFileAbsPath,
      newPath,
    );
    //Load tracks to generate attributes
    const tracks = await loadJsonTracks(newPath);
    const { attributes } = processTrackAttributes(Object.values(tracks));
    // eslint-disable-next-line no-param-reassign
    if (attributes) jsonMeta.attributes = attributes;
    foundDetections = true;
  }
  if (!foundDetections && userTrackFileAbsPath && CsvFileName.test(userTrackFileAbsPath)) {
    const csvFileCandidates = [userTrackFileAbsPath];

    const { fps, processedFiles, attributes } = await processOtherAnnotationFiles(
      settings, dsId, csvFileCandidates,
    );
    // eslint-disable-next-line no-param-reassign
    if (fps) jsonMeta.fps = fps;
    // eslint-disable-next-line no-param-reassign
    if (attributes) jsonMeta.attributes = attributes;
    foundDetections = processedFiles.length > 0;
  }


  /* custom image sort */
  jsonMeta.originalImageFiles.sort(strNumericCompare);
  if (jsonMeta.transcodedImageFiles) {
    jsonMeta.transcodedImageFiles.sort(strNumericCompare);
  }

  await _saveAsJson(npath.join(projectDirAbsPath, JsonMetaFileName), jsonMeta);

  /* create an empty file as fallback */
  if (!foundDetections) {
    await _saveSerialized(settings, dsId, {}, true);
  }
  return jsonMeta;
}

/**
 * Finalize a dataset import.
 */
async function finalizeMediaImport(
  settings: Settings,
  args: MediaImportPayload,
  updater: DesktopJobUpdater,
  convertMedia: ConvertMedia,
) {
  const { jsonMeta, globPattern } = args;
  let { mediaConvertList } = args;
  const { type: datasetType, id: dsId } = jsonMeta;
  const projectDirAbsPath = await _initializeProjectDir(settings, jsonMeta);

  // Filter all parts of the input based on glob pattern
  if (globPattern && jsonMeta.type === 'image-sequence') {
    const found = await findImagesInFolder(jsonMeta.originalBasePath, globPattern);
    if (found.images.length === 0) {
      throw new Error(`no images in ${jsonMeta.originalBasePath} matched pattern ${globPattern}`);
    }
    jsonMeta.originalImageFiles = found.images;
    mediaConvertList = found.mediaConvertList;
  }

  if (jsonMeta.type === 'video') {
    // Verify that the user didn't choose an FPS value higher than originalFPS
    // This shouldn't be possible in the UI, but we should still prevent it here.
    jsonMeta.fps = Math.floor(
      Math.max(1, Math.min(jsonMeta.fps, jsonMeta.originalFps)),
    );
  }

  //Now we will kick off any conversions that are necessary
  let jobBase = null;
  if (mediaConvertList.length) {
    const srcDstList: [string, string][] = [];
    const extension = datasetType === 'video' ? '.mp4' : '.png';
    let destAbsPath = '';
    mediaConvertList.forEach((item) => {
      const destLoc = item.replace(jsonMeta.originalBasePath, projectDirAbsPath);
      //If we have multicam we may need to check more than the base folder
      if (datasetType === 'multi') {
        destAbsPath = transcodeMultiCam(jsonMeta, item, projectDirAbsPath);
      } else {
        destAbsPath = destLoc.replace(npath.extname(item), extension);
        if (datasetType === 'video') {
          jsonMeta.transcodedVideoFile = npath.basename(destAbsPath);
        } else if (datasetType === 'image-sequence') {
          if (!jsonMeta.transcodedImageFiles) {
            jsonMeta.transcodedImageFiles = [];
          }
          jsonMeta.transcodedImageFiles.push(npath.basename(destAbsPath));
        }
      }
      srcDstList.push([item, destAbsPath]);
    });
    jobBase = await convertMedia(
      settings,
      {
        meta: jsonMeta,
        mediaList: srcDstList,
      },
      updater,
    );
    jsonMeta.transcodingJobKey = jobBase.key;
  }

  //We need to create datasets for each of the multiCam folders as well
  if (datasetType === 'multi' && jsonMeta.multiCam?.cameras) {
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
      await _importTrackFile(settings, jsonClone.id,
        cameraDirAbsPath, jsonClone, multiCamTrackFile);
    }
  }
  const finalJsonMeta = await _importTrackFile(
    settings, dsId, projectDirAbsPath, jsonMeta, args.trackFileAbsPath,
  );
  return finalJsonMeta;
}

/**
 * After media conversion we need to remove the transcodingKey to signify it is done
 */
async function completeConversion(
  settings: Settings, datasetId: string, transcodingJobKey: string,
) {
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  const existing = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  if (existing.transcodingJobKey === transcodingJobKey) {
    existing.transcodingJobKey = undefined;
    saveMetadata(settings, datasetId, existing);
  }
}

async function openLink(url: string) {
  shell.openExternal(url);
}

async function exportDataset(settings: Settings, args: ExportDatasetArgs) {
  const projectDirInfo = await getValidatedProjectDir(settings, args.id);
  const meta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  const data = await loadJsonTracks(projectDirInfo.trackFileAbsPath);
  return viameSerializers.serializeFile(args.path, data, meta, args.typeFilter, {
    excludeBelowThreshold: args.exclude,
    header: true,
  });
}

export {
  ProjectsFolderName,
  JobsFolderName,
  autodiscoverData,
  beginMediaImport,
  deleteDataset,
  checkDataset,
  annotationImport,
  createKwiverRunWorkingDir,
  exportDataset,
  finalizeMediaImport,
  getPipelineList,
  getTrainingConfigs,
  getProjectDir,
  getValidatedProjectDir,
  loadMetadata,
  loadJsonMetadata,
  loadJsonTracks,
  loadDetections,
  openLink,
  processOtherAnnotationFiles,
  saveDetections,
  saveMetadata,
  completeConversion,
  processTrainedPipeline,
  saveAttributes,
  findImagesInFolder,
  findTrackFileinFolder,
};
