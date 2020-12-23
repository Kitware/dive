/**
 * Common native implementations
 */
import npath from 'path';
import fs from 'fs-extra';
import { shell } from 'electron';
import mime from 'mime-types';
import moment from 'moment';
import type { TrackData } from 'vue-media-annotator/track';
import {
  DatasetType, MultiTrackRecord, Pipelines, SaveDetectionsArgs, FrameImage,
} from 'viame-web-common/apispec';

import {
  JsonMeta, Settings, websafeImageTypes, websafeVideoTypes, JsonMetaCurrentVersion, DesktopDataset, otherImageTypes,
} from 'platform/desktop/constants';
import * as viameSerializers from 'platform/desktop/backend/serializers/viame';

import { makeMediaUrl } from '../server';
import { cleanString, makeid } from './utils';
import { number } from 'yargs';

const ProjectsFolderName = 'DIVE_Projects';
const TrainedPipelinesFolderName = 'DIVE_Trained_Pipelines';
const AuxFolderName = 'auxiliary';
const JobFolderName = 'job_runs';

const JsonFileName = /^result(_.*)?\.json$/;
const JsonMetaFileName = 'meta.json';
const CsvFileName = /^.*\.csv$/;

/**
 * locate json track file in a directory
 * @param path path to a directory
 * @returns absolute path to json file or null
 */
async function _findJsonTrackFile(basePath: string): Promise<string | null> {
  const contents = await fs.readdir(basePath);
  const jsonFileCandidates: string[] = [];
  await Promise.all(contents.map(async (name) => {
    if (JsonFileName.test(name)) {
      const fullPath = npath.join(basePath, name);
      const statResult = await fs.stat(fullPath);
      if (statResult.isFile()) {
        jsonFileCandidates.push(fullPath);
      }
    }
  }));
  if (jsonFileCandidates.length > 1) {
    throw new Error(`too many matches for json annotation file in ${basePath}`);
  } else if (jsonFileCandidates.length === 1) {
    return jsonFileCandidates[0];
  }
  return null;
}

/**
 * _getProjectDir returns filepaths to required members of a dataset project directory.
 *
 * REQUIRED members: meta.json, results*.json
 *
 * OPTIONAL members: aux/ will be created if none exists
 *
 * @param settings user settings
 * @param datasetId dataset id string
 */
async function _getProjectDir(settings: Settings, datasetId: string) {
  const basePath = npath.join(settings.dataPath, ProjectsFolderName, datasetId);
  if (!fs.pathExistsSync(basePath)) {
    throw new Error(`missing project directory ${basePath}`);
  }

  const auxDirAbsPath = npath.join(basePath, AuxFolderName);
  fs.ensureDirSync(auxDirAbsPath);

  const metaFileAbsPath = npath.join(basePath, JsonMetaFileName);
  if (!fs.pathExists(metaFileAbsPath)) {
    throw new Error(`missing metadata json file ${metaFileAbsPath}`);
  }

  const trackFileAbsPath = await _findJsonTrackFile(basePath);
  if (trackFileAbsPath === null) {
    throw new Error(`missing track json file in ${basePath}`);
  }

  return {
    auxDirAbsPath,
    basePath,
    metaFileAbsPath,
    trackFileAbsPath,
  };
}

/**
 * _loadJsonMeta processes dataset information from json
 * @param metaPath a known, existing path
 */
async function _loadJsonMeta(metaAbsPath: string): Promise<JsonMeta> {
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
 * _loadJsonTracks load from file
 * @param tracksPath a known, existing path
 */
async function _loadJsonTracks(tracksAbsPath: string): Promise<MultiTrackRecord> {
  const rawBuffer = await fs.readFile(tracksAbsPath, 'utf-8');
  const annotationData = JSON.parse(rawBuffer) as MultiTrackRecord;
  // TODO: somehow verify the schema of this file
  if (Array.isArray(annotationData)) {
    throw new Error('object expected in track json');
  }
  return annotationData;
}

/**
 * loadDataset load detections and meta from disk
 * @param settings user settings
 * @param datasetId user data folder name
 */
async function loadDataset(settings: Settings, datasetId: string): Promise<DesktopDataset> {
  const projectDirData = await _getProjectDir(settings, datasetId);
  const projectMetaData = await _loadJsonMeta(projectDirData.metaFileAbsPath);

  let videoUrl = '';
  let imageData = [] as FrameImage[];

  /* Generate URLs against embedded media server from known file paths on disk */
  if (projectMetaData.type === 'video') {
    /* If the video has been transcoded, use that video */
    if (projectMetaData.transcodedVideoFile) {
      videoUrl = makeMediaUrl(
        npath.join(projectDirData.basePath, projectMetaData.transcodedVideoFile),
      );
    } else {
      videoUrl = makeMediaUrl(
        npath.join(projectMetaData.originalBasePath, projectMetaData.originalVideoFile),
      );
    }
  } else if (projectMetaData.type === 'image-sequence') {
    /* TODO: if images were transcoded, use them */
    imageData = projectMetaData.originalImageFiles.map((filename: string) => ({
      url: makeMediaUrl(npath.join(projectMetaData.originalBasePath, filename)),
      filename,
    }));
  } else {
    throw new Error(`unexpected project type for id="${datasetId}" type="${projectMetaData.type}"`);
  }

  return {
    meta: {
      ...projectMetaData,
      videoUrl,
      imageData,
    },
    tracks: await _loadJsonTracks(projectDirData.trackFileAbsPath),
  };
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
 * Create aux directory if none exists
 * @param baseDir parent
 */
async function getAuxFolder(baseDir: string): Promise<string> {
  const auxFolderPath = npath.join(baseDir, AuxFolderName);
  if (!fs.existsSync(auxFolderPath)) {
    await fs.mkdir(auxFolderPath);
  }
  return auxFolderPath;
}

/**
 * Create `job_runs/{runfoldername}` folder, usually inside an aux folder
 * @param baseDir parent
 * @param pipeline name
 */
async function createKwiverRunWorkingDir(datasetName: string, baseDir: string, pipeline: string) {
  const jobFolderPath = npath.join(baseDir, JobFolderName);
  // eslint won't recognize \. as valid escape
  // eslint-disable-next-line no-useless-escape
  const safeDatasetName = datasetName.replace(/[\.\s/]+/g, '_');
  const runFolderName = moment().format(`[${safeDatasetName}_${pipeline}]_MM-DD-yy_hh-mm-ss`);
  const runFolderPath = npath.join(jobFolderPath, runFolderName);
  if (!fs.existsSync(jobFolderPath)) {
    await fs.mkdir(jobFolderPath);
  }
  await fs.mkdir(runFolderPath);
  return runFolderPath;
}

/**
 * _saveSerialized save pre-serialized tracks to disk
 * @param trackData json serialized track object
 */
async function _saveSerialized(
  datasetId: string,
  trackData: MultiTrackRecord,
) {
  const time = moment().format('MM-DD-YYYY_HH-MM-SS');
  const newFileName = `result_${time}.json`;
  const base = await getDatasetBase(datasetId);

  const auxFolderPath = await getAuxFolder(base.basePath);

  /* Move old file if it exists */
  if (base.jsonFile) {
    await fs.move(
      npath.join(base.basePath, base.jsonFile),
      npath.join(auxFolderPath, base.jsonFile),
    );
  }

  const serialized = JSON.stringify(trackData);

  /* Save new file */
  await fs.writeFile(npath.join(base.basePath, newFileName), serialized);
}

/**
 * Save detections to json file in aux
 * @param datasetId path
 * @param args save args
 */
async function saveDetections(settings: Settings, datasetId: string, args: SaveDetectionsArgs) {
  /* Update existing track file */
  const projectDirInfo = await _getProjectDir(settings, datasetId);
  const existing = await _loadJsonTracks(projectDirInfo.trackFileAbsPath);
  args.delete.forEach((trackId) => delete existing[trackId.toString()]);
  args.upsert.forEach((track, trackId) => {
    existing[trackId.toString()] = track.serialize();
  });
  return _saveSerialized(datasetId, existing);
}

/**
 * processOtherAnnotationFiles imports data from external annotation formats
 *
 * Only VIAME CSV is currently supported.
 *
 * @param paths paths to possible input annotation files
 * @param datasetId dataset id path
 */
async function processOtherAnnotationFiles(
  absPaths: string[], datasetId: string,
): Promise<{ fps?: number }> {
  const fps = undefined;
  for (let i = 0; i < absPaths.length; i += 1) {
    const path = absPaths[i];
    if (!fs.existsSync(path)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    if (fs.statSync(path).size > 0) {
      // Attempt to process the file
      // eslint-disable-next-line no-await-in-loop
      const tracks = await viameSerializers.parseFile(path);
      const data = {} as Record<string, TrackData>;
      tracks.forEach((t) => { data[t.trackId.toString()] = t; });
      // eslint-disable-next-line no-await-in-loop
      await _saveSerialized(datasetId, data);
      break; // Exit on first successful detection load
    }
  }
  return { fps };
}

async function _initializeAppDataDir(settings: Settings) {
  await fs.ensureDir(settings.dataPath);
  await fs.ensureDir(npath.join(settings.dataPath, ProjectsFolderName));
  await fs.ensureDir(npath.join(settings.dataPath, TrainedPipelinesFolderName));
}

/**
 * Intialize a new project directory
 * @returns absolute path to new project dcirectory
 */
async function _initializeProjectDir(settings: Settings, jsonMeta: JsonMeta): string {
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
async function importMedia(settings: Settings, path: string): Promise<string> {
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
  let datasetFolderPath = path;
  if (datasetType === 'video') {
    // get parent folder, since videos reference a file directly
    datasetFolderPath = npath.dirname(path);
  }

  let imageFiles: string[] = [];
  const transcodedImageFiles: string[] = []; // TODO: unused
  let videoFile = '';
  const transcodedVideoFile = ''; // TODO: unused
  const contents = await fs.readdir(datasetFolderPath);

  /* Extract and validate media from import path */
  if (datasetType === 'video') {
    videoFile = npath.basename(path);
    const mimetype = mime.lookup(path);
    if (mimetype) {
      if (websafeImageTypes.includes(mimetype) || otherImageTypes.includes(mimetype)) {
        throw new Error('User chose image file for video import option');
      } else if (websafeVideoTypes.includes(mimetype)) {
        /* TODO: Kick off video inspection and maybe transcode */
      }
    } else {
      throw new Error(`Could not determine video MIME type for ${path}`);
    }
  } else if (datasetType === 'image-sequence') {
    imageFiles = contents.filter((filename) => {
      const abspath = npath.join(datasetFolderPath, filename);
      const mimetype = mime.lookup(abspath);
      /* TODO: support transcoding of non-web-safe image types */
      return !!(mimetype && websafeImageTypes.includes(mimetype));
    });
  } else {
    throw new Error('Only video and image-sequence types are supported');
  }


  // TODO: parse FPS from CSV if it exists

  const jsonMeta: JsonMeta = {
    version: JsonMetaCurrentVersion,
    type: datasetType,
    id: dsId,
    fps: 5, // TODO
    originalMediaAbsolutePath: path,
    imageFiles,
    name: dsName,
  };

  const projectDirAbsPath = await _initializeProjectDir(settings, jsonMeta);

  /* Look for JSON track file */
  const trackFileAbsPath = await _findJsonTrackFile(datasetFolderPath);
  if (trackFileAbsPath !== null) {
    /* Move the track file into the new project directory */
    await fs.move(
      trackFileAbsPath,
      npath.join(projectDirAbsPath, npath.basename(trackFileAbsPath)),
    );
  /* Look for other supported annotation types */
  } else {
    const csvFileCandidates = contents
      .filter((v) => CsvFileName.test(v))
      .map((filename) => npath.join(datasetFolderPath, filename));
    const { fps } = await processOtherAnnotationFiles(csvFileCandidates, dsId);
    
  }

}


async function openLink(url: string) {
  shell.openExternal(url);
}

export default {
  openLink,
  getAuxFolder,
  createKwiverRunWorkingDir,
  getPipelineList,
  loadDetections,
  saveDetections,
  postprocess,
};
