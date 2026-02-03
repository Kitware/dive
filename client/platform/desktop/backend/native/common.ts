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
  cloneDeep, merge, uniq, pick,
} from 'lodash';

import { DefaultConfidence } from 'vue-media-annotator/BaseFilterControls';
import { TrackData } from 'vue-media-annotator/track';
import { GroupData } from 'vue-media-annotator/Group';
import {
  DatasetType, Pipelines, SaveDetectionsArgs,
  FrameImage, DatasetMetaMutable, TrainingConfigs, SaveAttributeArgs,
  MultiCamMedia,
  DatasetMetaMutableKeys,
  AnnotationSchema,
  SaveAttributeTrackFilterArgs,
  Pipe,
} from 'dive-common/apispec';
import * as viameSerializers from 'platform/desktop/backend/serializers/viame';
import * as nistSerializers from 'platform/desktop/backend/serializers/nist';
import * as dive from 'platform/desktop/backend/serializers/dive';
import kpf from 'platform/desktop/backend/serializers/kpf';
// TODO:  Check to Refactor this
// eslint-disable-next-line import/no-cycle
import { checkMedia } from 'platform/desktop/backend/native/mediaJobs';
import {
  websafeImageTypes, websafeVideoTypes, otherImageTypes, otherVideoTypes, MultiType, JsonMetaRegEx,
} from 'dive-common/constants';
import {
  JsonMeta, Settings, JsonMetaCurrentVersion, DesktopMetadata,
  RunTraining, ExportDatasetArgs, DesktopMediaImportResponse,
  ExportConfigurationArgs, JobsFolderName, ProjectsFolderName,
  PipelinesFolderName, ConversionArgs,
  JobType, LastCalibrationFileName,
} from 'platform/desktop/constants';
import {
  cleanString, filterByGlob, makeid, strNumericCompare,
} from 'platform/desktop/sharedUtils';

import processTrackAttributes from './attributeProcessor';
import { upgrade } from './migrations';
// TODO:  Check to Refactor this
// eslint-disable-next-line import/no-cycle
import { getMultiCamUrls, transcodeMultiCam } from './multiCamUtils';
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

  let videoUrl = '';
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
      imageData = projectMetaData.originalImageFiles.map((pathOrFilename: string) => {
        const absPath = npath.join(projectMetaData.originalBasePath, pathOrFilename);
        return {
          url: makeMediaUrl(absPath),
          filename: npath.basename(absPath),
        };
      });
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
  const disallowedPatterns = /.*local.*|detector_svm_models.pipe|tracker_svm_models.pipe/;
  const exists = await fs.pathExists(pipelinePath);
  if (!exists) return {};
  let pipes = await fs.readdir(pipelinePath);
  pipes = pipes.filter((p) => p.match(allowedPatterns) && !p.match(disallowedPatterns));

  /* TODO: fetch trained pipelines */
  const ret: Pipelines = {};
  pipes.forEach((p) => {
    const parts = cleanString(p.replace('.pipe', '')).split('_');
    let pipeType = parts[0];
    let pipeName = parts.slice(1).join(' ');
    // Extract out only 2-cam and 3-cam pipelines to own category, 1-cam remain in tracker/detector
    if (parts.length > 1 && parts[parts.length - 1] === 'cam' && parts[parts.length - 2] !== '1') {
      pipeType = `${parts[parts.length - 2]}-cam`;
      pipeName = parts.join(' ');
    }
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
  let configs = await fs.readdir(pipelinePath);
  configs = configs
    .filter((p) => (p.match(allowedPatterns) && !p.match(disallowedPatterns)))
    .sort((a, b) => (a === defaultTrainingConfiguration ? -1 : a.localeCompare(b)));
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
      default: configs[0],
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

  /* Path to search for other related data like annotations */
  let relatedDataSearchPath = jsonMeta.originalBasePath;

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
  } else {
    throw new Error('only video and image-sequence types are supported');
  }

  const { trackFileAbsPath, metaFileAbsPath } = await
  findTrackandMetaFileinFolder(relatedDataSearchPath);
  return {
    jsonMeta,
    globPattern: '',
    mediaConvertList,
    trackFileAbsPath,
    forceMediaTranscode: false,
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
    if (args.forceMediaTranscode) {
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

async function openLink(url: string) {
  shell.openExternal(url);
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

/**
 * Get path to last_calibration.json if it exists
 * @returns path to last calibration file or null if it doesn't exist
 */
async function getLastCalibrationPath(settings: Settings): Promise<string | null> {
  const calibrationPath = npath.join(settings.dataPath, LastCalibrationFileName);
  if (await fs.pathExists(calibrationPath)) {
    return calibrationPath;
  }
  return null;
}

/**
 * Save a calibration file as the last used calibration
 * @param settings app settings
 * @param sourcePath path to the source calibration file
 * @returns path to the saved calibration file
 */
async function saveLastCalibration(settings: Settings, sourcePath: string): Promise<string> {
  const destPath = npath.join(settings.dataPath, LastCalibrationFileName);
  await fs.copy(sourcePath, destPath, { overwrite: true });
  return destPath;
}

/**
 * Apply calibration to all stereo datasets that don't already have calibration set
 * @param settings app settings
 * @param calibrationPath path to the calibration file to apply
 * @returns list of dataset IDs that were updated
 */
async function applyCalibrationToUncalibratedStereoDatasets(
  settings: Settings,
  calibrationPath: string,
): Promise<string[]> {
  const datasets = await autodiscoverData(settings);
  const updatedIds: string[] = [];

  for (let i = 0; i < datasets.length; i += 1) {
    const meta = datasets[i];
    // Check if this is a stereo dataset without calibration
    if (meta.subType === 'stereo' && meta.multiCam && !meta.multiCam.calibration) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const projectDirInfo = await getValidatedProjectDir(settings, meta.id);
        // eslint-disable-next-line no-await-in-loop
        const fullMeta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
        if (fullMeta.multiCam) {
          fullMeta.multiCam.calibration = calibrationPath;
          // eslint-disable-next-line no-await-in-loop
          await _saveAsJson(projectDirInfo.metaFileAbsPath, fullMeta);
          updatedIds.push(meta.id);
        }
      } catch (err) {
        // Skip datasets that fail to update
        console.error(`Failed to update calibration for dataset ${meta.id}:`, err);
      }
    }
  }

  return updatedIds;
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
  loadMetadata,
  loadJsonMetadata,
  loadAnnotationFile,
  loadDetections,
  openLink,
  ingestDataFiles,
  saveDetections,
  saveMetadata,
  processTrainedPipeline,
  saveAttributes,
  saveAttributeTrackFilters,
  findImagesInFolder,
  findTrackandMetaFileinFolder,
  getLastCalibrationPath,
  saveLastCalibration,
  applyCalibrationToUncalibratedStereoDatasets,
};
