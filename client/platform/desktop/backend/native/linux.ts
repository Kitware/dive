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
  FFProbeResults,
  DesktopJobUpdater,
  JsonMeta,
} from 'platform/desktop/constants';

import { DatasetType } from 'viame-web-common/apispec';
import common from './common';

const DefaultSettings: Settings = {
  // The current settings schema config
  version: SettingsCurrentVersion,
  // A path to the VIAME base install
  viamePath: '/opt/noaa/viame',
  // Path to a user data folder
  dataPath: npath.join(os.homedir(), 'VIAME_DATA'),
};

async function validateViamePath(settings: Settings): Promise<true | string> {
  const setupScriptPath = npath.join(settings.viamePath, 'setup_viame.sh');
  const setupExists = await fs.pathExists(setupScriptPath);
  if (!setupExists) {
    return `${setupScriptPath} does not exist`;
  }

  const kwiverExistsOnPath = spawn(
    `source ${setupScriptPath} && which kwiver`,
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

/**
 * Fashioned as a node.js implementation of viame_tasks.tasks.run_pipeline
 *
 * @param datasetIdPath dataset path absolute
 * @param pipeline pipeline file basename
 * @param settings global settings
 */
async function runPipeline(
  settings: Settings,
  runPipelineArgs: RunPipeline,
  updater: (msg: DesktopJobUpdate) => void,
): Promise<DesktopJob> {
  const { datasetId, pipeline } = runPipelineArgs;
  const isValid = await validateViamePath(settings);
  if (isValid !== true) {
    throw new Error(isValid);
  }

  const setupScriptPath = npath.join(settings.viamePath, 'setup_viame.sh');
  const pipelinePath = npath.join(settings.viamePath, 'configs/pipelines', pipeline.pipe);
  const projectInfo = await common.getValidatedProjectDir(settings, datasetId);
  const meta = await common.loadJsonMetadata(projectInfo.metaFileAbsPath);
  const jobWorkDir = await common.createKwiverRunWorkingDir(settings, [meta], pipeline.name);

  const detectorOutput = npath.join(jobWorkDir, 'detector_output.csv');
  const trackOutput = npath.join(jobWorkDir, 'track_output.csv');
  const joblog = npath.join(jobWorkDir, 'runlog.txt');

  let command: string[] = [];
  if (meta.type === 'video') {
    const videoAbsPath = npath.join(meta.originalBasePath, meta.originalVideoFile);
    command = [
      `source ${setupScriptPath} &&`,
      'kwiver runner',
      '-s input:video_reader:type=vidl_ffmpeg',
      `-p ${pipelinePath}`,
      `-s input:video_filename=${videoAbsPath}`,
      `-s detector_writer:file_name=${detectorOutput}`,
      `-s track_writer:file_name=${trackOutput}`,
      `| tee ${joblog}`,
    ];
  } else if (meta.type === 'image-sequence') {
    // Create frame image manifest
    const manifestFile = npath.join(jobWorkDir, 'image-manifest.txt');
    // map image file names to absolute paths
    const fileData = meta.originalImageFiles
      .map((f) => npath.join(meta.originalBasePath, f))
      .join('\n');
    await fs.writeFile(manifestFile, fileData);
    command = [
      `source ${setupScriptPath} &&`,
      'kwiver runner',
      `-p "${pipelinePath}"`,
      `-s input:video_filename="${manifestFile}"`,
      `-s detector_writer:file_name="${detectorOutput}"`,
      `-s track_writer:file_name="${trackOutput}"`,
      `| tee "${joblog}"`,
    ];
  }

  const job = spawn(command.join(' '), {
    shell: '/bin/bash',
    cwd: jobWorkDir,
  });

  const jobBase: DesktopJob = {
    key: `pipeline_${job.pid}_${jobWorkDir}`,
    jobType: 'pipeline',
    pid: job.pid,
    pipeline,
    workingDir: jobWorkDir,
    datasetIds: [datasetId],
    exitCode: job.exitCode,
    startTime: new Date(),
  };

  const processChunk = (chunk: Buffer) => chunk
    .toString('utf-8')
    .split('\n')
    .filter((a) => a);

  job.stdout.on('data', (chunk: Buffer) => {
    // eslint-disable-next-line no-console
    console.debug(chunk.toString('utf-8'));
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
    // eslint-disable-next-line no-console
    if (code === 0) {
      try {
        await common.processOtherAnnotationFiles(
          settings, datasetId, [trackOutput, detectorOutput],
        );
      } catch (err) {
        console.error(err);
      }
    }
    updater({
      ...jobBase,
      body: [''],
      exitCode: code,
      endTime: new Date(),
    });
  });

  return jobBase;
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
  const result = spawnSync(command.join(' '),
    { shell: '/bin/bash' });
  if (result.error) {
    throw result.error;
  }
  const ffprobeJSON: FFProbeResults = JSON.parse(result.stdout.toString('utf-8'));
  if (ffprobeJSON && ffprobeJSON.streams) {
    console.log(ffprobeJSON);
    const websafe = ffprobeJSON.streams.filter((el) => (el.codec_name === 'h264' && el.codec_type === 'video'));

    return !!websafe.length;
  }
  return false;
}

function convertMedia(settings: Settings,
  meta: JsonMeta,
  mediaList: [string, string][],
  type: DatasetType,
  updater: DesktopJobUpdater): DesktopJob {
  // TODO:  Do we need a run log for conversion?
  //const joblog = npath.join(jobWorkDir, 'runlog.txt');

  // TODO:  Avoiding issues with VIAME ffmpeg and x264 support for right now
  const setupScriptPath = npath.join(settings.viamePath, 'setup_viame.sh');
  const ffmpegPath = 'ffmpeg'; // `"${settings.viamePath}/bin/ffmpeg"`;
  const commands: string[] = [];//[`source ${setupScriptPath} &&`];
  if (type === 'video' && mediaList[0]) {
    commands.push(`${ffmpegPath} -i "${mediaList[0][0]}" -c:v libx264 -preset slow -crf 26 -c:a copy "${mediaList[0][1]}"`);
  }

  //commands.push(`| tee "${joblog}"`);
  console.log(commands.join(' '));
  console.log(meta);
  const job = spawn(commands.join(' '), { shell: '/bin/bash' });

  const jobBase: DesktopJob = {
    key: `convert_${job.pid}_${meta.originalBasePath}`,
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
    console.log('On Exit');
    console.log(code);
    if (code !== 0) {
      console.error('Error with running conversion');
    } else {
      //Here we do the updating for the JSON Meta
      common.completeConversion(settings, meta.id, job.pid);
    }
    updater({
      ...jobBase,
      body: [''],
      exitCode: code,
      endTime: new Date(),
    });
  });
  return jobBase;
}


export default {
  DefaultSettings,
  validateViamePath,
  runPipeline,
  nvidiaSmi,
  checkMedia,
  convertMedia,
};
