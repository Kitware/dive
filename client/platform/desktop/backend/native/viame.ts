import npath from 'path';
import { spawn } from 'child_process';
import fs from 'fs-extra';

import {
  Settings, DesktopJob, RunPipeline, RunTraining,
  DesktopJobUpdater,
} from 'platform/desktop/constants';
import { cleanString } from 'platform/desktop/sharedUtils';
import { serialize } from 'platform/desktop/backend/serializers/viame';
import { observeChild } from 'platform/desktop/backend/native/processManager';

import { MultiType, stereoPipelineMarker, multiCamPipelineMarkers } from 'dive-common/constants';
import * as common from './common';
import { jobFileEchoMiddleware, createWorkingDirectory } from './utils';
import {
  getMultiCamImageFiles, getMultiCamVideoPath,
  writeMultiCamStereoPipelineArgs,
} from './multiCamUtils';


const PipelineRelativeDir = 'configs/pipelines';
const DiveJobManifestName = 'dive_job_manifest.json';

export interface ViameConstants {
  setupScriptAbs: string; // abs path setup comman
  trainingExe: string; // name of training binary on PATH
  kwiverExe: string; // name of kwiver binary on PATH
  shell: string | boolean; // shell arg for spawn
}

/**
 * a node.js implementation of dive_tasks.tasks.run_pipeline
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

  let pipelinePath = npath.join(settings.viamePath, PipelineRelativeDir, pipeline.pipe);
  if (runPipelineArgs.pipeline.type === 'trained') {
    pipelinePath = pipeline.pipe;
  }
  const projectInfo = await common.getValidatedProjectDir(settings, datasetId);
  const meta = await common.loadJsonMetadata(projectInfo.metaFileAbsPath);
  const jobWorkDir = await createWorkingDirectory(settings, [meta], pipeline.name);

  const detectorOutput = npath.join(jobWorkDir, 'detector_output.csv');
  let trackOutput = npath.join(jobWorkDir, 'track_output.csv');
  const joblog = npath.join(jobWorkDir, 'runlog.txt');

  //TODO: TEMPORARY FIX FOR DEMO PURPOSES
  let requiresInput = false;
  if ((/utility_/g).test(pipeline.pipe)) {
    requiresInput = true;
  }
  let groundTruthFileName;
  if (requiresInput) {
    // MultiCam ids have '/' in it to designate camera, replace to make a valid location
    groundTruthFileName = `groundtruth_${meta.id.replace('/', '_')}.csv`;
    const groundTruthFileStream = fs.createWriteStream(
      npath.join(jobWorkDir, groundTruthFileName),
    );
    const inputData = await common.loadAnnotationFile(projectInfo.trackFileAbsPath);
    await serialize(groundTruthFileStream, inputData, meta);
    groundTruthFileStream.end();
  }

  let metaType = meta.type;

  if (metaType === MultiType && meta.multiCam) {
    metaType = meta.multiCam.cameras[meta.multiCam.defaultDisplay].type;
  }

  let command: string[] = [];
  const stereoOrMultiCam = (pipeline.type === stereoPipelineMarker
    || multiCamPipelineMarkers.includes(pipeline.type));

  if (metaType === 'video') {
    let videoAbsPath = npath.join(meta.originalBasePath, meta.originalVideoFile);
    if (meta.type === MultiType) {
      videoAbsPath = getMultiCamVideoPath(meta);
    } else if (meta.transcodedVideoFile) {
      videoAbsPath = npath.join(projectInfo.basePath, meta.transcodedVideoFile);
    }
    command = [
      `${viameConstants.setupScriptAbs} &&`,
      `"${viameConstants.kwiverExe}" runner`,
      '-s "input:video_reader:type=vidl_ffmpeg"',
      `-p "${pipelinePath}"`,
      `-s downsampler:target_frame_rate=${meta.fps}`,
    ];
    if (!stereoOrMultiCam) {
      command.push(`-s input:video_filename="${videoAbsPath}"`);
      command.push(`-s detector_writer:file_name="${detectorOutput}"`);
      command.push(`-s track_writer:file_name="${trackOutput}"`);
    }
  } else if (metaType === 'image-sequence') {
    // Create frame image manifest
    const manifestFile = npath.join(jobWorkDir, 'image-manifest.txt');
    // map image file names to absolute paths
    let imageList = meta.originalImageFiles;
    if (meta.type === MultiType) {
      imageList = getMultiCamImageFiles(meta);
    }
    const fileData = imageList
      .map((f) => npath.join(meta.originalBasePath, f))
      .join('\n');
    await fs.writeFile(manifestFile, fileData);
    command = [
      `${viameConstants.setupScriptAbs} &&`,
      `"${viameConstants.kwiverExe}" runner`,
      `-p "${pipelinePath}"`,
    ];
    if (!stereoOrMultiCam) {
      command.push(`-s input:video_filename="${manifestFile}"`);
      command.push(`-s detector_writer:file_name="${detectorOutput}"`);
      command.push(`-s track_writer:file_name="${trackOutput}"`);
    }
  }
  if (requiresInput && !stereoOrMultiCam) {
    command.push(`-s detection_reader:file_name="${groundTruthFileName}"`);
    command.push(`-s track_reader:file_name="${groundTruthFileName}"`);
  }

  let multiOutFiles: Record<string, string>;
  if (meta.multiCam && stereoOrMultiCam) {
    // eslint-disable-next-line max-len
    const { argFilePair, outFiles } = await writeMultiCamStereoPipelineArgs(jobWorkDir, meta, settings, requiresInput);
    Object.entries(argFilePair).forEach(([arg, file]) => {
      command.push(`-s ${arg}="${file}"`);
    });
    multiOutFiles = {};
    Object.entries(outFiles).forEach(([cameraName, fileName]) => {
      multiOutFiles[cameraName] = npath.join(jobWorkDir, fileName);
    });
    trackOutput = npath.join(jobWorkDir, outFiles[meta.multiCam.defaultDisplay]);

    if (meta.multiCam.calibration) {
      command.push(`-s measurer:calibration_file="${meta.multiCam.calibration}"`);
    }
  } else if (pipeline.type === stereoPipelineMarker) {
    throw new Error('Attempting to run a multicam pipeline on non multicam data');
  }

  const job = observeChild(spawn(command.join(' '), {
    shell: viameConstants.shell,
    cwd: jobWorkDir,
  }));

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

  fs.writeFile(npath.join(jobWorkDir, DiveJobManifestName), JSON.stringify(jobBase, null, 2));

  updater({
    ...jobBase,
    body: [''],
  });

  job.stdout.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));
  job.stderr.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));

  job.on('exit', async (code) => {
    if (code === 0) {
      try {
        const { meta: newMeta } = await common.ingestDataFiles(
          settings, datasetId, [detectorOutput, trackOutput], multiOutFiles,
        );
        if (newMeta) {
          meta.attributes = newMeta.attributes;
          await common.saveMetadata(settings, datasetId, meta);
        }
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
 * a node.js implementation of dive_tasks.tasks.run_training
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
  const jobWorkDir = await createWorkingDirectory(
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
      const inputData = await common.loadAnnotationFile(projectInfo.trackFileAbsPath);
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
      inputFile.write(`${videopath}\n`);
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
    '--no-adv-prints',
    '--no-embedded-pipe',
  ];

  if (runTrainingArgs.annotatedFramesOnly) {
    command.push('--gt-frames-only');
  }

  const job = observeChild(spawn(command.join(' '), {
    shell: viameConstants.shell,
    cwd: jobWorkDir,
  }));

  const cleanPipelineName = cleanString(runTrainingArgs.pipelineName);

  const jobBase: DesktopJob = {
    key: `pipeline_${job.pid}_${jobWorkDir}`,
    command: command.join(' '),
    jobType: 'training',
    pid: job.pid,
    args: runTrainingArgs,
    title: cleanPipelineName,
    workingDir: jobWorkDir,
    datasetIds: runTrainingArgs.datasetIds,
    exitCode: job.exitCode,
    startTime: new Date(),
  };

  fs.writeFile(npath.join(jobWorkDir, DiveJobManifestName), JSON.stringify(jobBase, null, 2));

  updater({
    ...jobBase,
    body: [''],
  });

  job.stdout.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));
  job.stderr.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));
  job.on('exit', async (code) => {
    let exitCode = code;
    const bodyText = [''];
    if (code === 0) {
      try {
        await common.processTrainedPipeline(
          settings, runTrainingArgs, jobWorkDir,
        );
      } catch (err) {
        console.error(err);
        exitCode = 1;
        bodyText.unshift((err as Error).toString());
        fs.appendFile(joblog, bodyText[0], (error) => {
          if (error) throw error;
        });
      }
    }
    updater({
      ...jobBase,
      body: bodyText,
      exitCode,
      endTime: new Date(),
    });
  });
  return jobBase;
}

export {
  runPipeline,
  train,
};
