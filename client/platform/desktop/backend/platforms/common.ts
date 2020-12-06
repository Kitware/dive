/**
 * Common native implementations
 */
import npath from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { shell } from 'electron';
import mime from 'mime-types';
import { xml2json } from 'xml-js';
import moment from 'moment';
import { TrackData } from 'vue-media-annotator/track';
import { DatasetType, Pipelines, SaveDetectionsArgs } from 'viame-web-common/apispec';

import { Settings, NvidiaSmiReply, websafeImageTypes } from '../../constants';
import * as viameSerializers from '../serializers/viame';

const AuxFolderName = 'auxiliary';
const JobFolderName = 'job_runs';
// Match examples:
// result_09-14-2020_14-49-05.json
// result_<ANYTHING>.json
// result.json
const JsonFileName = /^result(_.*)?\.json$/;
const CsvFileName = /^.*\.csv$/;

async function getDatasetBase(datasetId: string): Promise<{
  datasetType: DatasetType;
  basePath: string;
  name: string;
  jsonFile: string | null;
  imageFiles: string[];
  directoryContents: string[];
}> {
  let datasetType: DatasetType = 'image-sequence';
  const exists = fs.existsSync(datasetId);
  if (!exists) {
    throw new Error(`No dataset exists with path ${datasetId}`);
  }
  const stat = await fs.stat(datasetId);

  if (stat.isDirectory()) {
    datasetType = 'image-sequence';
  } else if (stat.isFile()) {
    datasetType = 'video';
  } else {
    throw new Error('Only regular files and directories are supported');
  }

  let datasetFolderPath = datasetId;
  if (datasetType === 'video') {
    // get parent folder, since videos reference a file directly
    datasetFolderPath = npath.dirname(datasetId);
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

  return {
    datasetType,
    basePath: datasetFolderPath,
    jsonFile,
    imageFiles,
    name: npath.parse(datasetId).name,
    directoryContents: contents,
  };
}

/**
 * Load annotations from JSON
 * @param path a known, existing path
 */
async function loadJsonAnnotations(path: string): Promise<Record<string, TrackData>> {
  const rawBuffer = await fs.readFile(path, 'utf-8');
  const annotationData = JSON.parse(rawBuffer);
  // TODO: validate json schema
  return annotationData as Record<string, TrackData>;
}

/**
 * Load detections from disk in priority order
 * @param datasetId path
 * @param ignoreCSV ignore CSV files if found
 */
async function loadDetections(datasetId: string, ignoreCSV = false):
  Promise<{ [key: string]: TrackData }> {
  const data = {} as { [key: string]: TrackData };
  const base = await getDatasetBase(datasetId);

  /* First, look for a JSON file */
  if (base.jsonFile) {
    const annotations = loadJsonAnnotations(npath.join(base.basePath, base.jsonFile));
    return annotations;
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

  /* return empty by default */
  return Promise.resolve(data);
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

async function openLink(url: string) {
  shell.openExternal(url);
}

export default {
  openLink,
  getAuxFolder,
  createKwiverRunWorkingDir,
  getDatasetBase,
  getPipelineList,
  loadDetections,
  saveDetections,
  postprocess,
};
