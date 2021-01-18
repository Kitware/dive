/**
 * VIAME process manager for linux platform
 */
import os from 'os';
import npath from 'path';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs-extra';
import { xml2json } from 'xml-js';

import {
  Settings, SettingsCurrentVersion,
  DesktopJob, DesktopJobUpdate, RunPipeline,
  NvidiaSmiReply,
  RunTraining,
} from 'platform/desktop/constants';

import * as viame from './viame';

const DefaultSettings: Settings = {
  // The current settings schema config
  version: SettingsCurrentVersion,
  // A path to the VIAME base install
  viamePath: '/opt/noaa/viame',
  // Path to a user data folder
  dataPath: npath.join(os.homedir(), 'VIAME_DATA'),
};

interface FFmpegSettings {
  initialization: string;
  path: string;
  encoding: string;
}
const ffmpegSettings: FFmpegSettings = {
  initialization: '', // command to initialize
  path: '', // location of the ffmpeg executable
  encoding: '', //encoding mode used
};

async function validateViamePath(settings: Settings): Promise<true | string> {
  const setupScriptPath = npath.join(settings.viamePath, ViameLinuxConstants.setup);
  const setupExists = await fs.pathExists(setupScriptPath);
  if (!setupExists) {
    return `${setupScriptPath} does not exist`;
  }

  const trainingScriptPath = npath.join(settings.viamePath, 'bin', ViameLinuxConstants.trainingExe);
  const trainingExists = await fs.pathExists(trainingScriptPath);
  if (!trainingExists) {
    return `${trainingScriptPath} does not exist`;
  }

  const kwiverExistsOnPath = spawn(
    `source ${setupScriptPath} && which ${ViameLinuxConstants.kwiverExe}`,
    { shell: '/bin/bash' },
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

async function runPipeline(
  settings: Settings,
  runPipelineArgs: RunPipeline,
  updater: (msg: DesktopJobUpdate) => void,
): Promise<DesktopJob> {
  const setupScriptAbs = npath.join(settings.viamePath, ViameLinuxConstants.setup);
  return viame.runPipeline(settings, runPipelineArgs, updater, validateViamePath, {
    ...ViameLinuxConstants,
    setupScriptAbs: `. "${setupScriptAbs}"`,
  });
}

async function train(
  settings: Settings,
  runTrainingArgs: RunTraining,
  updater: (msg: DesktopJobUpdate) => void,
): Promise<DesktopJob> {
  const setupScriptPath = npath.join(settings.viamePath, ViameLinuxConstants.setup);
  return viame.train(settings, runTrainingArgs, updater, validateViamePath, {
    ...ViameLinuxConstants,
    setupScriptAbs: `. "${setupScriptPath}"`,
  });
}

// Based on https://github.com/chrisallenlane/node-nvidia-smi
async function nvidiaSmi(): Promise<NvidiaSmiReply> {
  return new Promise((resolve) => {
    const smi = spawn('nvidia-smi', ['-q', '-x']);
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
  });
}

/**
 * Checs the video file for the codec type and
 * returns true if it is x264, if not will return false for media conversion
 */
function checkMedia(settings: Settings, file: string): boolean {
  const setupScriptPath = npath.join(settings.viamePath, 'setup_viame.sh');
  const ffprobePath = `"${settings.viamePath}/bin/ffprobe"`;
  const command = [
    `source ${setupScriptPath} &&`,
    `${ffprobePath}`,
    '-print_format',
    'json',
    '-v',
    'quiet',
    '-show_format',
    '-show_streams',
    file,
  ];
  //We try the initial ffprobe first
  if (!fs.existsSync(`${settings.viamePath}/bin/ffprobe`)) {
    // fall back to local ffprobe
    const localProbe = spawnSync('whereis ffprobe', { shell: '/bin/bash' });
    if (localProbe.error) {
      throw new Error('ffprobe not installed, please download VIAME Toolkit from the main page');
    }
    const location = localProbe.stdout.toString('utf-8').split(':');
    if (/\S/.test(location[1])) {
      command.splice(1, 1);
      command[0] = 'ffprobe';
    } else {
      throw new Error('ffprobe not installed, please download and install VIAME Toolkit from the main page');
    }
  }
  const result = spawnSync(command.join(' '),
    { shell: '/bin/bash' });
  if (result.error) {
    throw result.error;
  }
  const ffprobeJSON: FFProbeResults = JSON.parse(result.stdout.toString('utf-8'));
  if (ffprobeJSON && ffprobeJSON.streams) {
    const websafe = ffprobeJSON.streams.filter((el) => (el.codec_name === 'h264' && el.codec_type === 'video'));
    return !!websafe.length;
  }
  return false;
}

/**
 * module level variable of ffmpegSettings stores settings so calculation is done only once
 */
function ffmpegCommand(settings: Settings): FFmpegSettings {
  if (ffmpegSettings.path !== '' && ffmpegSettings.encoding !== '') {
    return ffmpegSettings;
  }
  const setupScriptPath = npath.join(settings.viamePath, 'setup_viame.sh');
  const ffmpegPath = `"${settings.viamePath}/bin/ffmpeg"`;
  const init = `source ${setupScriptPath} &&`;

  //First lets see if the VIAME install has libx264
  const ffmpegViameExists = fs.existsSync(`${settings.viamePath}/bin/ffmpeg`);
  if (ffmpegViameExists) {
    const viameffmpeg = spawnSync(`${init} ${ffmpegPath} -encoders`, { shell: '/bin/bash' });
    if (!viameffmpeg.error) {
      const ffmpegOutput = viameffmpeg.stdout.toString('utf-8');
      if (ffmpegOutput.includes('libx264')) {
        ffmpegSettings.initialization = `source ${setupScriptPath} &&`;
        ffmpegSettings.path = `"${settings.viamePath}/bin/ffmpeg"`;
        ffmpegSettings.encoding = '-c:v libx264 -preset slow -crf 26 -c:a copy';
        return ffmpegSettings;
      }
    }
  }
  //Now we need to test for a local install with libx264
  const localffmpeg = spawnSync('ffmpeg -encoders', { shell: '/bin/bash' });
  if (!localffmpeg.error) {
    if (localffmpeg.stdout.toString('utf-8').includes('libx264')) {
      ffmpegSettings.initialization = '';
      ffmpegSettings.path = 'ffmpeg';
      ffmpegSettings.encoding = '-c:v libx264 -preset slow -crf 26 -c:a copy';
      return ffmpegSettings;
    }
  }
  // As long as VIAMEffmpeg exists we can attempt to use nvida encoding
  if (ffmpegViameExists) {
    ffmpegSettings.initialization = `source ${setupScriptPath} &&`;
    ffmpegSettings.path = `"${settings.viamePath}/bin/ffmpeg"`;
    ffmpegSettings.encoding = '-c:v h264 -c:a copy';
    return ffmpegSettings;
  }
  //We make it down here we have no way to convert the video file
  throw new Error('ffmpeg not installed, please download and install VIAME Toolkit from the main page');
}

function convertMedia(settings: Settings,
  meta: JsonMeta,
  mediaList: [string, string][],
  type: DatasetType,
  updater: DesktopJobUpdater,
  imageIndex = 0,
  key = ''): DesktopJob {
  const ffSettings = ffmpegCommand(settings);
  const commands = [];
  if (type === 'video' && mediaList[0]) {
    commands.push(`${ffSettings.initialization} ${ffSettings.path} -i "${mediaList[0][0]}" ${ffSettings.encoding} "${mediaList[0][1]}"`);
  } else if (type === 'image-sequence' && imageIndex < mediaList.length) {
    commands.push(`${ffSettings.initialization} ${ffSettings.path} -i "${mediaList[imageIndex][0]}" "${mediaList[imageIndex][1]}"`);
  }

  const job = spawn(commands.join(' '), { shell: '/bin/bash' });
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
        body: [`Conversion ${imageIndex + 1} of ${mediaList.length} Complete`],
      });
      convertMedia(settings, meta, mediaList, type, updater, imageIndex + 1, jobKey);
    }
  });
  return jobBase;
}


export default {
  DefaultSettings,
  nvidiaSmi,
  checkMedia,
  convertMedia,
  runPipeline,
  train,
  validateViamePath,
};
