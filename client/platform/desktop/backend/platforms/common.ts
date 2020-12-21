/**
 * Common native implementations
 */
import npath from 'path';
import fs from 'fs-extra';
import { shell } from 'electron';
import mime from 'mime-types';
import moment from 'moment';
import { TrackData } from 'vue-media-annotator/track';
import {
  DatasetType, Pipelines, DatasetSchema, SaveDetectionsArgs, FrameImage,
} from 'viame-web-common/apispec';

import {
  JsonMeta, Settings, websafeImageTypes, websafeVideoTypes, JsonMetaCurrentVersion, DesktopDataset,
} from 'platform/desktop/constants';
import * as viameSerializers from 'platform/desktop/backend/serializers/viame';

import { cleanString, makeid } from './utils';

const ProjectsFolderName = 'DIVE_Projects';
const TrainedPipelinesFolderName = 'DIVE_Trained_Pipelines';
const AuxFolderName = 'auxiliary';
const JobFolderName = 'job_runs';

const JsonFileName = /^result(_.*)?\.json$/;
const JsonMetaFileName = 'meta.json';
const CsvFileName = /^.*\.csv$/;

/**
 * getProjectDir returns filepaths to required 
 * @param settings user settings
 * @param datasetId dataset id string
 */
function getProjectDir(settings: Settings, datasetId: string) {
  const basePath = npath.join(settings.dataPath, ProjectsFolderName, datasetId);
  if (!fs.pathExists(basePath)) {
    throw new Error(`missing project directory ${basePath}`);
  }
  const auxPath = npath.join(basePath, AuxFolderName);
  if (!fs.pathExists()) {
    throw new Error(`missing project aux path ${auxPath}`);
  }
  const metaPath = npath.join(basePath, JsonMetaFileName);
  if (!fs.pathExists(metaPath)) {
    throw new Error(`missing metadata json file ${metaPath}`);
  }
  let tracksPath =
  return {
    basePath,
    metaPath,
    auxPath,
  }
}

/**
 * loadMetadata combines information from JsonFile and directory structure
 * to produce a DatasetSchema compliant interface
 * @param jsonFile
 * @param directoryData
 */
async function _loadMetadata(jsonFile: JsonFileSchema, directoryData: DirectoryData): Promise<DesktopDataset> {
  let videoUrl = '';
  let videoPath = '';
  const imageData = [] as FrameImage[];
  const serverInfo = await mediaServerInfo();
  const contents = await fs.readdir(datasetFolderPath);

  function processFile(abspath: string) {
    const basename = npath.basename(abspath);
    const abspathuri = `http://localhost:${serverInfo.port}/api/media?path=${abspath}`;
    const mimetype = mime.lookup(abspath);
    if (mimetype && websafeVideoTypes.includes(mimetype)) {
      datasetType = 'video';
      basePath = path.dirname(datasetId); // parent directory of video;
      videoPath = abspath;
      videoUrl = abspathuri;
    } else if (mimetype && websafeImageTypes.includes(mimetype)) {
      datasetType = 'image-sequence';
      imageData.push({
        url: abspathuri,
        filename: basename,
      });
    }
  }

  const info = await fs.stat(datasetId);

  if (info.isDirectory()) {
    const contents = await fs.readdir(datasetId);
    for (let i = 0; i < contents.length; i += 1) {
      processFile(path.join(datasetId, contents[i]));
    }
  } else {
    processFile(datasetId);
  }

  const jsonFileCandidates: string[] = [];
  await Promise.all(contents.map(async (name) => {
    if (JsonFileName.test(name)) {
      const fullPath = npath.join(datasetFolderPath, name);
      const statResult = await fs.stat(fullPath);
      if (statResult.isFile()) {
        jsonFileCandidates.push(name);
      }
    }
  }));

  let jsonFile = null;
  if (jsonFileCandidates.length > 1) {
    throw new Error('Too many matches for json annotation file!');
  } else if (jsonFileCandidates.length === 1) {
    [jsonFile] = jsonFileCandidates;
  }

  if (datasetType === undefined) {
    throw new Error(`Cannot open dataset ${datasetId}: No images or video found`);
  }

  return Promise.resolve({
    name: npath.basename(datasetId),
    basePath,
    videoPath,
    meta: {
      type: datasetType,
      fps: 10,
      imageData: datasetType === 'image-sequence' ? imageData : [],
      videoUrl: datasetType === 'video' ? videoUrl : undefined,
    },
  });
}

/**
 * loadJsonFile processes dataset information from json
 * @param path a known, existing path
 */
async function _loadJsonMeta(settings: Settings, datasetId: string): Promise<JsonMeta> {
  const metaFile = npath.join(settings.dataPath, ProjectsFolderName)
  const rawBuffer = await fs.readFile(path, 'utf-8');
  const annotationData = JSON.parse(rawBuffer);

  /**
   * Check if this file meets the current schema version
   */
  if ('version' in annotationData) {
    const { version } = annotationData;
    if (version === CurrentSchemaVersion) {
      return annotationData as JsonFileSchema;
    }
    // TODO: schema migration for older schema versions
  }
  /**
   * DEPRECATED schema file with only tracks found, migrate
   * to latest schema version.
   */
  return {
    version: CurrentSchemaVersion,
    tracks: annotationData as { [key: string]: TrackData },
    meta: defaultMetadata,
  };
}

/**
 * Load detections from disk in priority order
 * @param datasetId user data folder name
 * @param ignoreCSV ignore CSV files if found
 */
async function loadDataset(datasetId: string, ignoreCSV = false): Promise<DesktopDataset> {
  const meta =

  /* First, look for a JSON file */
  if (base.jsonFile) {
    jsonData = await _loadJsonMeta(npath.join(base.basePath, base.jsonFile), defaultMetadata);
  }

  if (ignoreCSV) {
    return Promise.resolve(data);
  }

  /* Then, look for a CSV */
  const csvFileCandidates = base.directoryContents.filter((v) => CsvFileName.test(v));
  if (csvFileCandidates.length === 1) {
    const tracks = await viameSerializers.parseFile(
      npath.join(base.basePath, csvFileCandidates[0]),
    );
    tracks.forEach((t) => { data[t.trackId.toString()] = t; });
    return data;
  }

  const ds: DatasetSchema = {
    meta: {},
    tracks: {},
    version: CurrentSchemaVersion,
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
 * Save pre-serialized tracks to disk
 * @param datasetId path
 * @param trackData json serialized track object
 */
async function saveSerialized(
  datasetId: string,
  trackData: Record<string, TrackData>,
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
async function saveDetections(datasetId: string, args: SaveDetectionsArgs) {
  /* Update existing track file */
  const existing = await loadDetections(datasetId, true);
  args.delete.forEach((trackId) => delete existing[trackId.toString()]);
  args.upsert.forEach((track, trackId) => {
    existing[trackId.toString()] = track.serialize();
  });
  return saveSerialized(datasetId, existing);
}

/**
 * Postprocess possible annotation files
 * @param paths paths to input annotation files in descending priority order.
 *              Only the first successful input will be loaded.
 * @param datasetId dataset id path
 */
async function postprocess(paths: string[], datasetId: string) {
  for (let i = 0; i < paths.length; i += 1) {
    const path = paths[i];
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
      await saveSerialized(datasetId, data);
      break; // Exit on first successful detection load
    }
  }
}

async function _initializeAppDataDir(settings: Settings) {
  await fs.ensureDir(settings.dataPath);
  await fs.ensureDir(npath.join(settings.dataPath, ProjectsFolderName));
  await fs.ensureDir(npath.join(settings.dataPath, TrainedPipelinesFolderName));
}

async function _initializeProjectDir(settings: Settings, jsonMeta: JsonMeta) {
  const projectDir = npath.join(settings.dataPath, ProjectsFolderName, jsonMeta.id);
  await _initializeAppDataDir(settings);
  await fs.ensureDir(projectDir);
}

/**
 * importMedia takes in a path and locates as much information as possible
 * about the dataset using only the directory structure.
 * @param datasetId string path
 */
async function importMedia(settings: Settings, path: string): Promise<JsonMeta> {
  let datasetType: DatasetType = 'image-sequence';
  const exists = fs.existsSync(path);
  if (!exists) {
    throw new Error(`No dataset exists with path ${path}`);
  }
  const stat = await fs.stat(path);

  if (stat.isDirectory()) {
    datasetType = 'image-sequence';
  } else if (stat.isFile()) {
    datasetType = 'video';
  } else {
    throw new Error('Only regular files and directories are supported');
  }

  let datasetFolderPath = path;
  if (datasetType === 'video') {
    // get parent folder, since videos reference a file directly
    datasetFolderPath = npath.dirname(path);
  }

  const contents = await fs.readdir(datasetFolderPath);
  const jsonFileCandidates = contents.filter((v) => JsonFileName.test(v));
  let jsonFile = null;

  const imageFiles = contents.filter((filename) => {
    const abspath = npath.join(datasetFolderPath, filename);
    const mimetype = mime.lookup(abspath);
    if (mimetype && websafeImageTypes.includes(mimetype)) {
      return true;
    }
    return false;
  });

  if (jsonFileCandidates.length > 1) {
    throw new Error('Too many matches for json annotation file!');
  } else if (jsonFileCandidates.length === 1) {
    [jsonFile] = jsonFileCandidates;
  }

  // TODO: parse meta.json if you find it
  // TODO: parse FPS from CSV if it exists

  const dsName = npath.parse(path).name;
  const dsId = `${cleanString(dsName).substr(0, 20)}_${makeid(10)}`;
  const jsonMeta: JsonMeta = {
    version: JsonMetaCurrentVersion,
    type: datasetType,
    id: dsId,
    fps: 5, // TODO
    originalMediaAbsolutePath: path,
    imageFiles,
    name: dsName,
  };

  await _initializeProjectDir(settings, jsonMeta);

  postprocess()
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
