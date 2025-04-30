/**
 * VIAME process manager for linux platform
 */
import os from 'os';
import npath from 'path';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import { xml2json } from 'xml-js';

import {
  Settings, SettingsCurrentVersion,
  DesktopJob, RunPipeline,
  NvidiaSmiReply,
  RunTraining,
  DesktopJobUpdater,
  ExportTrainedPipeline,
} from 'platform/desktop/constants';
import { observeChild } from 'platform/desktop/backend/native/processManager';
import * as viame from './viame';

const DefaultSettings: Settings = {
  // The current settings schema config
  version: SettingsCurrentVersion,
  // A path to the VIAME base install
  viamePath: '/opt/noaa/viame',
  // read only mode flag
  readonlyMode: false,
  // Path to a user data folder
  dataPath: npath.join(os.homedir(), 'VIAME_DATA'),
  // environment overrides
  overrides: {
    // override VIAME install path from env
    viamePath: process.env.DIVE_VIAME_INSTALL_PATH,
    // override readonly mode flag
    readonlyMode: process.env.DIVE_READONLY_MODE
      ? process.env.DIVE_READONLY_MODE?.toLowerCase() === 'true'
      : undefined,
  },
};

const ViameLinuxConstants = {
  setup: 'setup_viame.sh',
  trainingExe: 'viame_train_detector',
  kwiverExe: 'kwiver',
  shell: '/bin/bash',
};

function sourceString(settings: Settings) {
  const setupScriptAbs = npath.join(settings.viamePath, ViameLinuxConstants.setup);
  return `. "${setupScriptAbs}"`;
}

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

  const kwiverExistsOnPath = observeChild(spawn(
    `${sourceString(settings)} && which ${ViameLinuxConstants.kwiverExe}`,
    { shell: '/bin/bash' },
  ));
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
  updater: DesktopJobUpdater,
): Promise<DesktopJob> {
  return viame.runPipeline(settings, runPipelineArgs, updater, validateViamePath, {
    ...ViameLinuxConstants,
    setupScriptAbs: sourceString(settings),
  });
}

async function exportTrainedPipeline(
  settings: Settings,
  exportTrainedPipelineArgs: ExportTrainedPipeline,
  updater: DesktopJobUpdater,
): Promise<DesktopJob> {
  return viame.exportTrainedPipeline(settings, exportTrainedPipelineArgs, updater, validateViamePath, {
    ...ViameLinuxConstants,
    setupScriptAbs: sourceString(settings)
  })
}

async function train(
  settings: Settings,
  runTrainingArgs: RunTraining,
  updater: DesktopJobUpdater,
): Promise<DesktopJob> {
  return viame.train(settings, runTrainingArgs, updater, validateViamePath, {
    ...ViameLinuxConstants,
    setupScriptAbs: sourceString(settings),
  });
}

// Based on https://github.com/chrisallenlane/node-nvidia-smi
async function nvidiaSmi(): Promise<NvidiaSmiReply> {
  return new Promise((resolve) => {
    const smi = observeChild(spawn('nvidia-smi', ['-q', '-x']));
    let result = '';
    smi.stdout.on('data', (chunk) => {
      result = result.concat(chunk.toString('utf-8'));
    });
    smi.on('exit', (exitCode) => {
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

export default {
  DefaultSettings,
  nvidiaSmi,
  runPipeline,
  exportTrainedPipeline,
  train,
  validateViamePath,
};
