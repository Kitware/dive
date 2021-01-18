/**
 * VIAME process manager for windows platform
 */
import os from 'os';
import npath from 'path';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs-extra';
import { xml2json } from 'xml-js';

import {
  Settings, SettingsCurrentVersion,
  DesktopJob, DesktopJobUpdate, RunPipeline,
  NvidiaSmiReply, RunTraining,
} from 'platform/desktop/constants';

import * as viame from './viame';

const DefaultSettings: Settings = {
  // The current settings schema config
  version: SettingsCurrentVersion,
  // A path to the VIAME base install
  viamePath: 'C:\\Program Files\\VIAME',
  // Path to a user data folder
  dataPath: npath.join(os.homedir(), 'VIAME_DATA'),
};

const ViameWindowsConstants = {
  setup: 'setup_viame.bat',
  trainingExe: 'viame_train_detector.exe',
  kwiverExe: 'kwiver.exe',
  shell: true,
};

let programFiles = 'C:\\Program Files';
// There exists no app.getPath('programfiles') so we need to
// check the variable for the default location
async function initialize() {
  const environmentVarPath = spawn('cmd.exe', ['/c', 'echo %PROGRAMFILES%'], { shell: true });
  environmentVarPath.stdout.on('data', (data) => {
    const trimmed = data.toString().trim();
    programFiles = trimmed;
    DefaultSettings.viamePath = `${trimmed}\\VIAME`;
  });
}

async function validateViamePath(settings: Settings): Promise<true | string> {
  const setupScriptPath = npath.join(settings.viamePath, 'setup_viame.bat');
  const setupExists = await fs.pathExists(setupScriptPath);
  if (!setupExists) {
    return `${setupScriptPath} does not exist`;
  }

  const modifiedCommand = `"${setupScriptPath.replace(/\\/g, '\\')}"`;
  const kwiverExistsOnPath = spawn(
    `${modifiedCommand} && kwiver.exe help`, {
      shell: true,
    },
  );
  return new Promise((resolve) => {
    kwiverExistsOnPath.on('exit', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        resolve('kwiver failed to initialize');
      }
    });
  });
}

// Mock the validate call when starting jobs because it just takes too long to run.
// TODO: maybe perform a lightweight check or some other test that doesn't spawn() kwiver
const validateFake = () => Promise.resolve(true as true);

async function runPipeline(
  settings: Settings,
  runPipelineArgs: RunPipeline,
  updater: (msg: DesktopJobUpdate) => void,
): Promise<DesktopJob> {
  return viame.runPipeline(settings, runPipelineArgs, updater, validateFake, {
    ...ViameWindowsConstants,
    setupScriptAbs: `"${npath.join(settings.viamePath, ViameWindowsConstants.setup)}"`,
  });
}

async function train(
  settings: Settings,
  runTrainingArgs: RunTraining,
  updater: (msg: DesktopJobUpdate) => void,
): Promise<DesktopJob> {
  return viame.train(settings, runTrainingArgs, updater, validateFake, {
    ...ViameWindowsConstants,
    setupScriptAbs: `"${npath.join(settings.viamePath, ViameWindowsConstants.setup)}"`,
  });
}

function checkDefaultNvidiaSmi(resolve: (value: NvidiaSmiReply) => void) {
  const smi = spawn(`"${programFiles}\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"`, ['-q', '-x'], { shell: true });
  let result = '';
  smi.stdout.on('data', (chunk) => {
    result = result.concat(chunk.toString('utf-8'));
  });

  smi.on('close', (exitCode) => {
    let jsonStr = 'null'; // parses to null
    if (exitCode === 0) {
      jsonStr = xml2json(result, { compact: true });
    }
    resolve({
      output: JSON.parse(jsonStr),
      exitCode,
      error: result,
    });
  });
  smi.on('error', (err) => {
    resolve({
      output: null,
      exitCode: -1,
      error: err.message,
    });
  });
}

// Note: this is the most recent location for the nvidia-smi
// it doesn't guarantee that the system doesn't have a relevant GPU
async function nvidiaSmi(): Promise<NvidiaSmiReply> {
  return new Promise((resolve) => {
    const pathsmi = spawn('nvidia-smi', ['-q', '-x'], { shell: true });
    let result = '';
    pathsmi.stdout.on('data', (chunk) => {
      // eslint-disable-next-line no-console
      console.log(chunk.toString('utf-8'));
      result = result.concat(chunk.toString('utf-8'));
    });

    pathsmi.on('close', (exitCode) => {
      let jsonStr = 'null'; // parses to null
      if (exitCode === 0) {
        jsonStr = xml2json(result, { compact: true });
        resolve({
          output: JSON.parse(jsonStr),
          exitCode,
          error: result,
        });
      } else {
        checkDefaultNvidiaSmi(resolve);
      }
    });
    pathsmi.on('error', () => {
      checkDefaultNvidiaSmi(resolve);
    });
  });
}

function checkMedia(settings: Settings, file: string): boolean {
  const setupScriptPath = npath.join(settings.viamePath, 'setup_viame.bat');

  const modifiedCommand = `"${setupScriptPath.replace(/\\/g, '\\')}"`;

  const ffprobePath = `${settings.viamePath}\\bin\\ffprobe.exe`;
  const ffprobeModified = `"${ffprobePath.replace(/\\/g, '\\')}"`;
  if (!fs.existsSync(setupScriptPath)) {
    throw new Error(`${modifiedCommand} does not exist and is required to convert files.  Please download and install the VIAME toolkit from the main page`);
  }
  const command = [
    `${modifiedCommand} &&`,
    `${ffprobeModified}`,
    '-print_format',
    'json',
    '-v',
    'quiet',
    '-show_format',
    '-show_streams',
    file,
  ];
  const result = spawnSync(command.join(' '),
    { shell: true });
  if (result.error) {
    throw result.error;
  }
  // TODO: I don't like the below for grabbing the JSON out of the return data
  const returnText = result.stdout.toString('utf-8');
  const firstIndex = returnText.indexOf('{');
  const lastIndex = returnText.lastIndexOf('}');
  if (firstIndex === -1 || lastIndex === -1) {
    throw new Error('No ffprobe found. Please download and install the VIAME toolkit from the main page`');
  }
  const json = returnText.substring(firstIndex, lastIndex + 1);
  const ffprobeJSON: FFProbeResults = JSON.parse(json);
  if (ffprobeJSON && ffprobeJSON.streams) {
    const websafe = ffprobeJSON.streams.filter((el) => el.codec_name === 'h264' && el.codec_type === 'video');

    return !!websafe.length;
  }
  return false;
}

function convertMedia(settings: Settings,
  meta: JsonMeta,
  mediaList: [string, string][],
  type: DatasetType,
  updater: DesktopJobUpdater,
  imageIndex = 0,
  key = ''): DesktopJob {
  //const joblog = npath.join(jobWorkDir, 'runlog.txt');

  const setupScriptPath = npath.join(settings.viamePath, 'setup_viame.bat');
  const ffmpegPath = `${settings.viamePath}\\bin\\ffmpeg.exe`;

  const modifiedCommand = `"${setupScriptPath.replace(/\\/g, '\\')}"`;
  const ffmpegModified = `"${ffmpegPath.replace(/\\/g, '\\')}"`;

  if (!fs.existsSync(setupScriptPath)) {
    throw new Error('ffmpeg does not exist and is required to convert files.  Please download and install the VIAME toolkit from the main page');
  }

  const commands: string[] = [`${modifiedCommand} &&`];
  if (type === 'video' && mediaList[0]) {
    commands.push(`${ffmpegModified} -i "${mediaList[0][0]}" -c:v libx264 -preset slow -crf 26 -c:a copy "${mediaList[0][1]}"`);
  } else if (type === 'image-sequence' && imageIndex < mediaList.length) {
    commands.push(`${ffmpegModified} -i "${mediaList[imageIndex][0]}" "${mediaList[imageIndex][1]}"`);
  }

  const job = spawn(commands.join(' '), {
    shell: true,
  });

  let jobKey = `convert_${job.pid}_${meta.originalBasePath}`;
  if (key.length) {
    jobKey = key;
  }

  const jobBase: DesktopJob = {
    key: jobKey,
    pid: job.pid,
    jobType: 'conversion',
    workingDir: meta.originalBasePath || DefaultSettings.dataPath,
    datasetIds: [meta.id],
    exitCode: job.exitCode,
    startTime: new Date(),
  };

  const processChunk = (chunk: Buffer) => chunk
    .toString('utf-8')
    .split('\n')
    .filter((a) => a);

  job.stdout.on('data', (chunk: Buffer) => {
    // eslint-disable-next-line no-console
    console.log(chunk.toString('utf-8'));
    updater({
      ...jobBase,
      body: processChunk(chunk),
    });
  });

  job.stderr.on('data', (chunk: Buffer) => {
    // eslint-disable-next-line no-console
    console.log(chunk.toString('utf-8'));
    updater({
      ...jobBase,
      body: processChunk(chunk),
    });
  });

  job.on('exit', async (code) => {
    if (code !== 0) {
      console.error('Error with running conversion');
    } else if (type === 'video' || (type === 'image-sequence' && imageIndex === mediaList.length - 1)) {
      common.completeConversion(settings, meta.id, jobKey);
      updater({
        ...jobBase,
        body: [''],
        exitCode: code,
        endTime: new Date(),
      });
    } else if (type === 'image-sequence') {
      updater({
        ...jobBase,
        body: [`Convertion ${imageIndex + 1} of ${mediaList.length} Complete`],
      });
      convertMedia(settings, meta, mediaList, type, updater, imageIndex + 1, jobKey);
    }
  });
  return jobBase;
}

export default {
  DefaultSettings,
  validateViamePath,
  runPipeline,
  train,
  nvidiaSmi,
  initialize,
  checkMedia,
  convertMedia,
};
