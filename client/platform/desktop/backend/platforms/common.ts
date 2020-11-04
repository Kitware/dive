/**
 * Common native implementations
 */
import npath from 'path';
// eslint-disable-next-line import/no-extraneous-dependencies
import fs from 'fs-extra';
import { spawn } from 'child_process';
// eslint-disable-next-line import/no-extraneous-dependencies
import { shell } from 'electron';
// eslint-disable-next-line import/no-extraneous-dependencies
import { xml2json } from 'xml-js';
import moment from 'moment';
import { DatasetType, Pipelines } from 'viame-web-common/apispec';
import { Settings } from 'platform/desktop/store/settings';

const AuxFolderName = 'auxiliary';
const JobFolderName = 'job_runs';
// Match examples:
// result_09-14-2020_14-49-05.json
// result_<ANYTHING>.json
// result.json
const JsonFileName = /^result(_.*)?\.json$/;

interface NvidiaSmiTextRecord {
  _text: string;
}

export interface NvidiaSmiReply {
  output: {
    nvidia_smi_log: {
      driver_version: NvidiaSmiTextRecord;
      cuda_version: NvidiaSmiTextRecord;
      attached_gpus: NvidiaSmiTextRecord;
    };
  } | null;
  code: number;
  error: string;
}

export interface JobCreatedReply {
  // The name of the pipe or job being run
  pipeline: string;
  // A unique identifier for the job
  jobName: string;
  // The pid of the process spawned
  pid: number;
  // The working directory of the job's output
  workingDir: string;
  // If exitCode is set, the job exited already
  exitCode?: number;
}

export interface JobUpdateReply {
  // Matches JobCreated identifier
  jobName: string;
  // Originating pid
  pid: number;
  // Update Body
  body: string;
  // If exitCode is set, the job exited already
  exitCode?: number;
}

async function getDatasetBase(datasetId: string): Promise<{
  datasetType: DatasetType;
  basePath: string;
  name: string;
  jsonFile: string | null;
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

  if (jsonFileCandidates.length > 1) {
    throw new Error('Too many matches for json annotation file!');
  } else if (jsonFileCandidates.length === 1) {
    [jsonFile] = jsonFileCandidates;
  }

  return {
    datasetType,
    basePath: datasetFolderPath,
    jsonFile,
    name: npath.parse(datasetId).name,
    directoryContents: contents,
  };
}

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

// Based on https://github.com/chrisallenlane/node-nvidia-smi
async function nvidiaSmi(): Promise<NvidiaSmiReply> {
  return new Promise((resolve) => {
    const smi = spawn('nvidia-smi', ['-q', '-x']);
    let result = '';
    smi.stdout.on('data', (chunk) => {
      result = result.concat(chunk.toString('utf-8'));
    });
    smi.on('close', (code) => {
      let jsonStr = 'null'; // parses to null
      if (code === 0) {
        jsonStr = xml2json(result, { compact: true });
      }
      resolve({
        output: JSON.parse(jsonStr),
        code,
        error: result,
      });
    });
    smi.on('error', (err) => {
      resolve({
        output: null,
        code: -1,
        error: err.message,
      });
    });
  });
}

async function openLink(url: string) {
  shell.openExternal(url);
}

export default {
  nvidiaSmi,
  openLink,
  getAuxFolder,
  createKwiverRunWorkingDir,
  getDatasetBase,
  getPipelineList,
};
