import { spawn } from 'child_process';
import fs from 'fs-extra';
import moment from 'moment';
import path from 'path';
import os from 'os';

import { observeChild } from 'platform/desktop/backend/native/processManager';
import {
  DesktopJob, DesktopJobUpdater, JsonMeta, Settings, JobsFolderName,
} from 'platform/desktop/constants';

const processChunk = (chunk: Buffer) => chunk
  .toString('utf-8')
  .split('\n')
  .filter((a) => a);

function isDev() {
  return process.env.NODE_ENV !== 'production';
}

function getBinaryPath(name: string) {
  const platform = process.env.npm_config_platform || os.platform();
  const filename = platform === 'win32' ? `${name}.exe` : name;
  if (isDev()) {
    return path.join(__dirname, '..', 'node_modules', filename);
  }
  return path.join(process.resourcesPath, filename);
}

/**
 * Middleware to echo to stdout and write to file
 */
function jobFileEchoMiddleware(
  jobBase: DesktopJob,
  updater: DesktopJobUpdater,
  logfile?: string,
) {
  return (chunk: Buffer) => {
    process.stdout.write(chunk.toString('utf-8'));
    // No way in windows to display and log stdout at same time without 3rd party tools
    if (logfile) {
      fs.appendFile(logfile, chunk.toString('utf-8'), (err) => {
        if (err) throw err;
      });
    }
    updater({
      ...jobBase,
      body: processChunk(chunk),
    });
  };
}

function spawnResult(command: string, args: string[] = []):
Promise<{ output: null | string; exitCode: number | null; error: string}> {
  return new Promise((resolve) => {
    const proc = observeChild(spawn(command, args));
    let output = '';
    let error = '';
    proc.stdout.on('data', (chunk) => {
      output = output.concat(chunk.toString('utf-8'));
    });

    proc.stderr.on('data', (chunk) => {
      error = error.concat(chunk.toString('utf-8'));
    });

    proc.on('exit', (exitCode) => {
      resolve({
        output,
        exitCode,
        error,
      });
    });
    proc.on('error', (err) => {
      resolve({
        output: null,
        exitCode: -1,
        error: err.message,
      });
    });
  });
}

/**
 * Create job run working directory
 */
async function createWorkingDirectory(
  settings: Settings, jsonMetaList: JsonMeta[], pipeline: string,
) {
  if (jsonMetaList.length === 0) {
    throw new Error('At least 1 jsonMeta item must be provided');
  }
  const jobFolderPath = path.join(settings.dataPath, JobsFolderName);
  // eslint won't recognize \. as valid escape
  // eslint-disable-next-line no-useless-escape
  const safeDatasetName = jsonMetaList[0].name.replace(/[\.\s/]+/g, '_');
  const runFolderName = moment().format(`[${safeDatasetName}_${pipeline}]_MM-DD-yy_hh-mm-ss.SSS`);
  const runFolderPath = path.join(jobFolderPath, runFolderName);
  if (!fs.existsSync(jobFolderPath)) {
    await fs.mkdir(jobFolderPath);
  }
  await fs.mkdir(runFolderPath);
  return runFolderPath;
}

/* same as os.path.splitext */
function splitExt(input: string): [string, string] {
  const ext = path.extname(input);
  return [path.basename(input, ext), ext];
}

export {
  isDev,
  getBinaryPath,
  jobFileEchoMiddleware,
  createWorkingDirectory,
  spawnResult,
  splitExt,
};
