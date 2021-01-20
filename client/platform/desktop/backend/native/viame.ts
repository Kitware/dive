import npath from 'path';
import { spawn } from 'child_process';
import fs from 'fs-extra';

import {
  Settings, DesktopJob, RunPipeline, RunTraining, FFProbeResults,
  ConversionArgs,
  DesktopJobUpdater,
} from 'platform/desktop/constants';
import { serialize } from 'platform/desktop/backend/serializers/viame';

import * as common from './common';
import { cleanString, jobFileEchoMiddleware, spawnResult } from './utils';

const PipelineRelativeDir = 'configs/pipelines';


interface FFmpegSettings {
  initialization: string;
  path: string;
  encoding: string;
}

interface ViameConstants {
  setupScriptAbs: string; // abs path setup comman
  trainingExe: string; // name of training binary on PATH
  kwiverExe: string; // name of kwiver binary on PATH
  shell: string | boolean; // shell arg for spawn
  ffmpeg: FFmpegSettings; //ffmpeg settings
}

/**
 * a node.js implementation of viame_tasks.tasks.run_pipeline
 */
async function runPipeline(
  settings: Settings,
  runPipelineArgs: RunPipeline,
  updater: DesktopJobUpdater,
  validateViamePath: (settings: Settings) => Promise<true | string>,
  viameConstants: ViameConstants,
): Promise<DesktopJob> {
  const { datasetId, pipeline } = runPipelineArgs;

  const isValid = await validateViamePath(settings);
  if (isValid !== true) {
    throw new Error(isValid);
  }

  const pipelinePath = npath.join(settings.viamePath, PipelineRelativeDir, pipeline.pipe);
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
      `${viameConstants.setupScriptAbs} &&`,
      `"${viameConstants.kwiverExe}" runner`,
      '-s "input:video_reader:type=vidl_ffmpeg"',
      `-p "${pipelinePath}"`,
      `-s input:video_filename="${videoAbsPath}"`,
      `-s detector_writer:file_name="${detectorOutput}"`,
      `-s track_writer:file_name="${trackOutput}"`,
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
      `${viameConstants.setupScriptAbs} &&`,
      `"${viameConstants.kwiverExe}" runner`,
      `-p "${pipelinePath}"`,
      `-s input:video_filename="${manifestFile}"`,
      `-s detector_writer:file_name="${detectorOutput}"`,
      `-s track_writer:file_name="${trackOutput}"`,
    ];
  }

  const job = spawn(command.join(' '), {
    shell: viameConstants.shell,
    cwd: jobWorkDir,
  });

  const jobBase: DesktopJob = {
    key: `pipeline_${job.pid}_${jobWorkDir}`,
    command: command.join(' '),
    jobType: 'pipeline',
    pid: job.pid,
    args: runPipelineArgs,
    title: runPipelineArgs.pipeline.name,
    workingDir: jobWorkDir,
    datasetIds: [datasetId],
    exitCode: job.exitCode,
    startTime: new Date(),
  };

  fs.writeFile(npath.join(jobWorkDir, 'dive_job_manifest.json'), JSON.stringify(jobBase));

  updater({
    ...jobBase,
    body: [''],
  });

  job.stdout.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));
  job.stderr.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));

  job.on('exit', async (code) => {
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

/**
 * a node.js implementation of viame_tasks.tasks.run_training
 */
async function train(
  settings: Settings,
  runTrainingArgs: RunTraining,
  updater: DesktopJobUpdater,
  validateViamePath: (settings: Settings) => Promise<true | string>,
  viameConstants: ViameConstants,
): Promise<DesktopJob> {
  const isValid = await validateViamePath(settings);
  if (isValid !== true) {
    throw new Error(isValid);
  }

  /* Zip together project info and meta */
  const infoAndMeta = await Promise.all(
    runTrainingArgs.datasetIds.map(async (id) => {
      const projectInfo = await common.getValidatedProjectDir(settings, id);
      const meta = await common.loadJsonMetadata(projectInfo.metaFileAbsPath);
      return { projectInfo, meta };
    }),
  );
  const jsonMetaList = infoAndMeta.map(({ meta }) => meta);

  // Working dir for training
  const jobWorkDir = await common.createKwiverRunWorkingDir(
    settings, jsonMetaList, runTrainingArgs.pipelineName,
  );

  // Argument files for training
  const inputFolderFileList = npath.join(jobWorkDir, 'input_folder_list.txt');
  const groundTruthFileList = npath.join(jobWorkDir, 'input_truth_list.txt');

  const groundtruthFilenames = await Promise.all(
    infoAndMeta.map(async ({ meta, projectInfo }) => {
      // Organize data for training
      const groundTruthFileName = `groundtruth_${meta.id}.csv`;
      const groundTruthFileStream = fs.createWriteStream(
        npath.join(jobWorkDir, groundTruthFileName),
      );
      const inputData = await common.loadJsonTracks(projectInfo.trackFileAbsPath);
      await serialize(groundTruthFileStream, inputData, meta);
      groundTruthFileStream.end();
      return groundTruthFileName;
    }),
  );

  // Write groundtruth filenames to list
  const groundtruthFile = fs.createWriteStream(groundTruthFileList);
  groundtruthFilenames.forEach((name) => groundtruthFile.write(`${name}\n`));
  groundtruthFile.end();

  // Write input folder paths to list
  const inputFile = fs.createWriteStream(inputFolderFileList);
  infoAndMeta.forEach(({ projectInfo, meta }) => {
    if (meta.type === 'video') {
      let videopath = '';
      /* If the video has been transcoded, use that video */
      if (meta.transcodedVideoFile) {
        videopath = npath.join(projectInfo.basePath, meta.transcodedVideoFile);
      } else {
        videopath = npath.join(meta.originalBasePath, meta.originalVideoFile);
      }
      inputFile.write(`${videopath}`);
    } else if (meta.type === 'image-sequence') {
      inputFile.write(`${npath.join(meta.originalBasePath)}\n`);
    }
  });
  inputFile.end();

  const joblog = npath.join(jobWorkDir, 'runlog.txt');
  const configFilePath = npath.join(
    settings.viamePath, PipelineRelativeDir, runTrainingArgs.trainingConfig,
  );

  const command = [
    `${viameConstants.setupScriptAbs} &&`,
    `"${viameConstants.trainingExe}"`,
    `--input-list "${inputFolderFileList}"`,
    `--input-truth "${groundTruthFileList}"`,
    `--config "${configFilePath}"`,
    '--no-query',
  ];

  const job = spawn(command.join(' '), {
    shell: viameConstants.shell,
    cwd: jobWorkDir,
  });

  const cleanPipelineName = cleanString(runTrainingArgs.pipelineName);

  const jobBase: DesktopJob = {
    key: `pipeline_${job.pid}_${jobWorkDir}`,
    command: command.join(' '),
    jobType: 'pipeline',
    pid: job.pid,
    args: runTrainingArgs,
    title: cleanPipelineName,
    workingDir: jobWorkDir,
    datasetIds: runTrainingArgs.datasetIds,
    exitCode: job.exitCode,
    startTime: new Date(),
  };

  fs.writeFile(npath.join(jobWorkDir, 'dive_job_manifest.json'), JSON.stringify(jobBase));

  updater({
    ...jobBase,
    body: [''],
  });

  job.stdout.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));
  job.stderr.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));
  job.on('exit', (code) => {
    updater({
      ...jobBase,
      body: [''],
      exitCode: code,
      endTime: new Date(),
    });
  });
  return jobBase;
}

async function checkMedia(
  viameConstants: ViameConstants,
  file: string,
): Promise<boolean> {
  const ffprobePath = `${viameConstants.ffmpeg.path.replace('ffmpeg', 'ffprobe')}`;
  const command = [
    `${viameConstants.ffmpeg.initialization}`,
    `${ffprobePath}`,
    '-print_format',
    'json',
    '-v',
    'quiet',
    '-show_format',
    '-show_streams',
    file,
  ];
  const result = await spawnResult(command.join(' '), viameConstants.shell);
  if (result.error || result.output === null) {
    throw result.error || 'Error using ffprobe';
  }
  const returnText = result.output;
  const ffprobeJSON: FFProbeResults = JSON.parse(returnText);
  if (ffprobeJSON && ffprobeJSON.streams) {
    const websafe = ffprobeJSON.streams.filter((el) => el.codec_name === 'h264' && el.codec_type === 'video');

    return !!websafe.length;
  }
  return false;
}

async function convertMedia(settings: Settings,
  args: ConversionArgs,
  updater: DesktopJobUpdater,
  viameConstants: ViameConstants,
  imageIndex = 0,
  key = ''): Promise<DesktopJob> {
  const commands = [];
  if (args.meta.type === 'video' && args.mediaList[0]) {
    commands.push(`${viameConstants.ffmpeg.initialization} ${viameConstants.ffmpeg.path} -i "${args.mediaList[0][0]}" ${viameConstants.ffmpeg.encoding} "${args.mediaList[0][1]}"`);
  } else if (args.meta.type === 'image-sequence' && imageIndex < args.mediaList.length) {
    commands.push(`${viameConstants.ffmpeg.initialization} ${viameConstants.ffmpeg.path} -i "${args.mediaList[imageIndex][0]}" "${args.mediaList[imageIndex][1]}"`);
  }

  const job = spawn(commands.join(' '), { shell: viameConstants.shell });
  let jobKey = `convert_${job.pid}_${args.meta.originalBasePath}`;
  if (key.length) {
    jobKey = key;
  }
  const jobBase: DesktopJob = {
    key: jobKey,
    pid: job.pid,
    command: commands.join(' '),
    args,
    title: `converting ${args.meta.name}`,
    jobType: 'conversion',
    workingDir: args.meta.originalBasePath,
    datasetIds: [args.meta.id],
    exitCode: job.exitCode,
    startTime: new Date(),
  };

  job.stdout.on('data', jobFileEchoMiddleware(jobBase, updater));
  job.stderr.on('data', jobFileEchoMiddleware(jobBase, updater));


  job.on('exit', async (code) => {
    if (code !== 0) {
      console.error('Error with running conversion');
    } else if (args.meta.type === 'video' || (args.meta.type === 'image-sequence' && imageIndex === args.mediaList.length - 1)) {
      common.completeConversion(settings, args.meta.id, jobKey);
      updater({
        ...jobBase,
        body: [''],
        exitCode: code,
        endTime: new Date(),
      });
    } else if (args.meta.type === 'image-sequence') {
      updater({
        ...jobBase,
        body: [`Conversion ${imageIndex + 1} of ${args.mediaList.length} Complete`],
      });
      convertMedia(settings, args, updater, viameConstants, imageIndex + 1, jobKey);
    }
  });
  return jobBase;
}
export {
  runPipeline,
  train,
  checkMedia,
  convertMedia,
};
