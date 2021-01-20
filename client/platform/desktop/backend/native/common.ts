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
  FrameImage, DatasetMetaMutable, TrainingConfigs,
} from 'viame-web-common/apispec';
import * as viameSerializers from 'platform/desktop/backend/serializers/viame';

import {
  websafeImageTypes, websafeVideoTypes, otherImageTypes, otherVideoTypes,
  JsonMeta, Settings, JsonMetaCurrentVersion, DesktopMetadata, DesktopJobUpdater, ConvertMedia,
} from 'platform/desktop/constants';
import { cleanString, makeid } from './utils';

const ProjectsFolderName = 'DIVE_Projects';
const JobsFolderName = 'DIVE_Jobs';
const AuxFolderName = 'auxiliary';

const JsonTrackFileName = /^result(_.*)?\.json$/;
const JsonMetaFileName = 'meta.json';
const CsvFileName = /^.*\.csv$/;

async function _acquireLock(dir: string, resource: string, lockname: 'meta' | 'tracks') {
  const release = await lockfile.lock(resource, {
    stale: 5000, // 5 seconds
    lockfilePath: npath.join(dir, `${lockname}.lock`),
  });
  return release;
}

/**
 * locate json track file in a directory
 * @param path path to a directory
 * @returns absolute path to json file or null
 */
async function _findJsonTrackFile(basePath: string): Promise<string | null> {
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
  if (jsonFileCandidates.length > 1) {
    throw new Error(`too many matches for json annotation file in ${basePath}.  cannot determine correct choice.  please verify only 1 json annotation file exists.`);
  } else if (jsonFileCandidates.length === 1) {
    return jsonFileCandidates[0];
  }
  return null;
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
  if (trackFileAbsPath === null) {
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
  const metaJson = JSON.parse(rawBuffer);
  /* check if this file meets the current schema version */
  if ('version' in metaJson) {
    const { version } = metaJson;
    if (version !== JsonMetaCurrentVersion) {
      // TODO: schema migration for older schema versions
      throw new Error('outdated meta schema version found, migration not implemented');
    }
  }
  return metaJson as JsonMeta;
}

/**
 * loadJsonTracks load from file
 * @param tracksPath a known, existing path
 */
async function loadJsonTracks(tracksAbsPath: string): Promise<MultiTrackRecord> {
  const rawBuffer = await fs.readFile(tracksAbsPath, 'utf-8');
  const annotationData = JSON.parse(rawBuffer) as MultiTrackRecord;
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

  /* Generate URLs against embedded media server from known file paths on disk */
  if (projectMetaData.type === 'video') {
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

  return {
    ...projectMetaData,
    videoUrl,
    imageData,
  };
}

async function loadDetections(settings: Settings, datasetId: string) {
  const projectDirData = await getValidatedProjectDir(settings, datasetId);
  return loadJsonTracks(projectDirData.trackFileAbsPath);
}

/**
 * Get all runnable pipelines
 * @param settings app settings
 */
async function getPipelineList(settings: Settings): Promise<Pipelines> {
  const pipelinePath = npath.join(settings.viamePath, 'configs/pipelines');
  const allowedPatterns = /^detector_.+|^tracker_.+|^generate_.+/;
  const disallowedPatterns = /.*local.*|detector_svm_models.pipe|tracker_svm_models.pipe/;
  const exists = await fs.pathExists(pipelinePath);
  if (!exists) return {};
  let pipes = await fs.readdir(pipelinePath);
  pipes = pipes.filter((p) => p.match(allowedPatterns) && !p.match(disallowedPatterns));

  /* TODO: fetch trained pipelines */
  const ret: Pipelines = {};
  pipes.forEach((p) => {
    const parts = p.replace('.pipe', '').split('_');
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
  return ret;
}

/**
 * get training configurations
 */
async function getTrainingConfigs(settings: Settings): Promise<TrainingConfigs> {
  const pipelinePath = npath.join(settings.viamePath, 'configs/pipelines');
  const allowedPatterns = /\.viame_csv\.conf$/;
  const exists = await fs.pathExists(pipelinePath);
  if (!exists) {
    throw new Error('Path does not exist');
  }
  let configs = await fs.readdir(pipelinePath);
  configs = configs
    .filter((p) => p.match(allowedPatterns))
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

async function saveMetadata(settings: Settings, datasetId: string, args: DatasetMetaMutable) {
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  const release = await _acquireLock(projectDirInfo.basePath, projectDirInfo.metaFileAbsPath, 'meta');
  const existing = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  if (args.confidenceFilters) {
    existing.confidenceFilters = args.confidenceFilters;
  }
  if (args.customTypeStyling) {
    existing.customTypeStyling = args.customTypeStyling;
  }
  await _saveAsJson(projectDirInfo.metaFileAbsPath, existing);
  await release();
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
 */
async function processOtherAnnotationFiles(
  settings: Settings,
  datasetId: string,
  absPaths: string[],
): Promise<{ fps?: number; processedFiles: string[] }> {
  const fps = undefined;
  const processedFiles = []; // which files were processed to generate the detections

  for (let i = 0; i < absPaths.length; i += 1) {
    const path = absPaths[i];
    if (!fs.existsSync(path)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    if (fs.statSync(path).size > 0) {
      // Attempt to process the file
      try {
        // eslint-disable-next-line no-await-in-loop
        const tracks = await viameSerializers.parseFile(path);
        const data: MultiTrackRecord = {};
        tracks.forEach((t) => { data[t.trackId.toString()] = t; });
        // eslint-disable-next-line no-await-in-loop
        await _saveSerialized(settings, datasetId, data, true);
        processedFiles.push(path);
        break; // Exit on first successful detection load
      } catch (err) {
        // eslint-disable-next-line no-continue
        continue;
      }
    }
  }
  return { fps, processedFiles };
}

async function _initializeAppDataDir(settings: Settings) {
  await fs.ensureDir(settings.dataPath);
  await fs.ensureDir(npath.join(settings.dataPath, ProjectsFolderName));
  await fs.ensureDir(npath.join(settings.dataPath, JobsFolderName));
}

/**
 * Intialize a new project directory
 * @returns absolute path to new project dcirectory
 */
async function _initializeProjectDir(settings: Settings, jsonMeta: JsonMeta): Promise<string> {
  const projectDir = npath.join(settings.dataPath, ProjectsFolderName, jsonMeta.id);
  await _initializeAppDataDir(settings);
  await fs.ensureDir(projectDir);
  return projectDir;
}

/**
 * importMedia locates as much information as possible
 * about a dataset using only the directory structure.
 * @param settings user settings
 * @param path path to import dir/file
 * @returns datasetId
 */
async function importMedia(
  settings: Settings,
  path: string,
  updater: DesktopJobUpdater,
  { checkMedia, convertMedia }: {
  checkMedia: (settings: Settings, path: string) => Promise<boolean>;
  convertMedia: ConvertMedia;
},
): Promise<JsonMeta> {
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

  const jsonMeta: JsonMeta = {
    version: JsonMetaCurrentVersion,
    type: datasetType,
    id: dsId,
    fps: 5, // TODO
    originalBasePath: path,
    originalVideoFile: '',
    createdAt: (new Date()).toString(),
    originalImageFiles: [],
    transcodedVideoFile: '',
    transcodedImageFiles: [],
    name: dsName,
  };

  /* TODO: Look for an EXISTING meta.json file to override the above */

  if (datasetType === 'video') {
    // get parent folder, since videos reference a file directly
    jsonMeta.originalBasePath = npath.dirname(path);
  }

  const contents = await fs.readdir(jsonMeta.originalBasePath);

  let mediaConvertList: string[] = [];
  /* Extract and validate media from import path */
  if (jsonMeta.type === 'video') {
    jsonMeta.originalVideoFile = npath.basename(path);
    const mimetype = mime.lookup(path);
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
  } else if (datasetType === 'image-sequence') {
    const tempConvertList: string[] = [];
    let convertAny = false; //If we have to convert one image we convert all for organization
    contents.forEach((filename) => {
      const abspath = npath.join(jsonMeta.originalBasePath, filename);
      const mimetype = mime.lookup(abspath);
      if (
        mimetype && (websafeImageTypes.includes(mimetype)
        || otherImageTypes.includes(mimetype))
      ) {
        jsonMeta.originalImageFiles.push(filename);
        tempConvertList.push(abspath);
        if (otherImageTypes.includes(mimetype)) {
          convertAny = true;
        }
      }
    });
    if (jsonMeta.originalImageFiles.length === 0) {
      throw new Error(`no images found in ${path}`);
    }
    if (convertAny) {
      mediaConvertList = tempConvertList;
    }
  } else {
    throw new Error('only video and image-sequence types are supported');
  }

  const projectDirAbsPath = await _initializeProjectDir(settings, jsonMeta);

  //Now we will kick off any conversions that are necessary
  let jobBase = null;
  if (mediaConvertList.length) {
    const srcDstList: [string, string][] = [];
    const extension = datasetType === 'video' ? '.mp4' : '.png';
    mediaConvertList.forEach((item) => {
      const destLoc = item.replace(jsonMeta.originalBasePath, projectDirAbsPath);
      const destAbsPath = destLoc.replace(npath.extname(item), extension);
      if (datasetType === 'video') {
        jsonMeta.transcodedVideoFile = npath.basename(destAbsPath);
      } else if (datasetType === 'image-sequence') {
        if (!jsonMeta.transcodedImageFiles) {
          jsonMeta.transcodedImageFiles = [];
        }
        jsonMeta.transcodedImageFiles.push(npath.basename(destAbsPath));
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

  await _saveAsJson(npath.join(projectDirAbsPath, JsonMetaFileName), jsonMeta);

  let foundDetections = false;

  /* Look for JSON track file as first priority */
  const trackFileAbsPath = await _findJsonTrackFile(jsonMeta.originalBasePath);
  if (trackFileAbsPath !== null) {
    /* Move the track file into the new project directory */
    await fs.copy(
      trackFileAbsPath,
      npath.join(projectDirAbsPath, npath.basename(trackFileAbsPath)),
    );
    foundDetections = true;
  }
  /* Look for other types of annotation files as a second priority */
  if (!foundDetections) {
    const csvFileCandidates = contents
      .filter((v) => CsvFileName.test(v))
      .map((filename) => npath.join(jsonMeta.originalBasePath, filename));
    if (csvFileCandidates.length > 1) {
      throw new Error(`too many CSV files found in ${jsonMeta.originalBasePath}, expected at most 1`);
    }
    const { fps, processedFiles } = await processOtherAnnotationFiles(
      settings, dsId, csvFileCandidates,
    );
    if (fps) jsonMeta.fps = fps;
    foundDetections = processedFiles.length > 0;
  }
  /* Finally create an empty file as fallback */
  if (!foundDetections) {
    await _saveSerialized(settings, dsId, {}, true);
  }

  return jsonMeta;
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

export {
  ProjectsFolderName,
  JobsFolderName,
  createKwiverRunWorkingDir,
  getPipelineList,
  getTrainingConfigs,
  getProjectDir,
  getValidatedProjectDir,
  importMedia,
  loadMetadata,
  loadJsonMetadata,
  loadJsonTracks,
  loadDetections,
  openLink,
  processOtherAnnotationFiles,
  saveDetections,
  saveMetadata,
  completeConversion,
};
