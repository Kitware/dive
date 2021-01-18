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
  DesktopJobUpdater,
  FFProbeResults,
  ConversionArgs,
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

const ViameLinuxConstants = {
  setup: 'setup_viame.sh',
  trainingExe: 'viame_train_detector',
  kwiverExe: 'kwiver',
  shell: '/bin/bash',
  ffmpeg: {
    initialization: '', // command to initialize
    path: '', // location of the ffmpeg executable
    encoding: '', //encoding mode used
  },
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
 * module level variable of ffmpegSettings stores settings so calculation is done only once
 */
function ffmpegCommand(settings: Settings): void {
  if (ViameLinuxConstants.ffmpeg.path !== '' && ViameLinuxConstants.ffmpeg.encoding !== '') {
    return;
  }
  const setupScriptPath = npath.join(settings.viamePath, ViameLinuxConstants.setup);
  const ffmpegPath = `"${settings.viamePath}/bin/ffmpeg"`;
  const init = `source ${setupScriptPath} &&`;

  //First lets see if the VIAME install has libx264
  const ffmpegViameExists = fs.existsSync(`${settings.viamePath}/bin/ffmpeg`);
  if (ffmpegViameExists) {
    const viameffmpeg = spawnSync(`${init} ${ffmpegPath} -encoders`, { shell: '/bin/bash' });
    if (!viameffmpeg.error) {
      const ffmpegOutput = viameffmpeg.stdout.toString('utf-8');
      if (ffmpegOutput.includes('libx264')) {
        ViameLinuxConstants.ffmpeg.initialization = `source ${setupScriptPath} &&`;
        ViameLinuxConstants.ffmpeg.path = `"${settings.viamePath}/bin/ffmpeg"`;
        ViameLinuxConstants.ffmpeg.encoding = '-c:v libx264 -preset slow -crf 26 -c:a copy';
        return;
      }
    }
  }
  //Now we need to test for a local install with libx264
  const localffmpeg = spawnSync('ffmpeg -encoders', { shell: '/bin/bash' });
  if (!localffmpeg.error) {
    if (localffmpeg.stdout.toString('utf-8').includes('libx264')) {
      ViameLinuxConstants.ffmpeg.initialization = '';
      ViameLinuxConstants.ffmpeg.path = 'ffmpeg';
      ViameLinuxConstants.ffmpeg.encoding = '-c:v libx264 -preset slow -crf 26 -c:a copy';
      return;
    }
  }
  // As long as VIAMEffmpeg exists we can attempt to use nvida encoding
  if (ffmpegViameExists) {
    ViameLinuxConstants.ffmpeg.initialization = `source ${setupScriptPath} &&`;
    ViameLinuxConstants.ffmpeg.path = `"${settings.viamePath}/bin/ffmpeg"`;
    ViameLinuxConstants.ffmpeg.encoding = '-c:v h264 -c:a copy';
    return;
  }
  //We make it down here we have no way to convert the video file
  throw new Error('ffmpeg not installed, please download and install VIAME Toolkit from the main page');
}

/**
 * Checs the video file for the codec type and
 * returns true if it is x264, if not will return false for media conversion
 */
function checkMedia(settings: Settings, file: string): boolean {
  ffmpegCommand(settings);
  const setupScriptAbs = npath.join(settings.viamePath, ViameLinuxConstants.setup);
  return viame.checkMedia({
    ...ViameLinuxConstants,
    setupScriptAbs: `. "${setupScriptAbs}"`,
  }, file);
}

function convertMedia(settings: Settings,
  args: ConversionArgs,
  updater: DesktopJobUpdater): DesktopJob {
  ffmpegCommand(settings);
  const setupScriptAbs = npath.join(settings.viamePath, ViameLinuxConstants.setup);
  return viame.convertMedia(settings, args, updater, {
    ...ViameLinuxConstants,
    setupScriptAbs: `. "${setupScriptAbs}"`,
  });
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
