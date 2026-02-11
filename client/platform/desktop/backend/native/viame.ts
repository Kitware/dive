import npath from 'path';
import { spawn } from 'child_process';
import fs from 'fs-extra';

import {
  Settings, DesktopJob, RunPipeline, RunTraining,
  DesktopJobUpdater,
  ExportTrainedPipeline,
  JsonMeta,
} from 'platform/desktop/constants';
import { cleanString } from 'platform/desktop/sharedUtils';
import { serialize } from 'platform/desktop/backend/serializers/viame';
import { observeChild } from 'platform/desktop/backend/native/processManager';
import { convertMedia } from 'platform/desktop/backend/native/mediaJobs';
import sendToRenderer from 'platform/desktop/background';

import {
  MultiType,
  stereoPipelineMarker,
  multiCamPipelineMarkers,
  pipelineCreatesDatasetMarkers,
} from 'dive-common/constants';
import * as common from './common';
import { jobFileEchoMiddleware, createWorkingDirectory, createCustomWorkingDirectory } from './utils';
import {
  getMultiCamImageFiles, getMultiCamVideoPath,
  writeMultiCamStereoPipelineArgs,
} from './multiCamUtils';

const PipelineRelativeDir = 'configs/pipelines';
const DiveJobManifestName = 'dive_job_manifest.json';

/**
 * Filter an image list to only include images within frame range.
 * @param imageList List of image file paths
 * @param frameRange Tuple of (start_frame, end_frame) inclusive (0-indexed)
 * @returns Filtered list of image file paths
 */
function filterImageListByFrameRange(
  imageList: string[],
  frameRange: [number, number],
): string[] {
  const [startFrame, endFrame] = frameRange;
  // Ensure we don't go out of bounds
  const safeStart = Math.max(0, startFrame);
  const safeEnd = Math.min(endFrame, imageList.length - 1);
  return imageList.slice(safeStart, safeEnd + 1);
}

/**
 * Filter VIAME CSV to only include detections within frame range.
 * @param csvPath Path to the input CSV file
 * @param frameRange Tuple of (start_frame, end_frame) inclusive
 * @returns Path to the filtered CSV file
 */
async function filterCsvByFrameRange(
  csvPath: string,
  frameRange: [number, number],
): Promise<string> {
  const [startFrame, endFrame] = frameRange;
  const filteredPath = csvPath.replace('.csv', '_filtered.csv');

  const content = await fs.readFile(csvPath, 'utf-8');
  const lines = content.split('\n');
  const filteredLines = lines.filter((line) => {
    if (line.startsWith('#') || line.trim() === '') {
      return true;
    }
    const parts = line.split(',');
    if (parts.length >= 3) {
      const frame = parseInt(parts[2], 10);
      return !Number.isNaN(frame) && frame >= startFrame && frame <= endFrame;
    }
    return false;
  });

  await fs.writeFile(filteredPath, filteredLines.join('\n'));
  return filteredPath;
}

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
  forceTranscodedVideo?: boolean,
): Promise<DesktopJob> {
  const { datasetId, pipeline, frameRange } = runPipelineArgs;

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
  if ((/utility_|filter_|transcode_|measurement_/g).test(pipeline.pipe)) {
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
      videoAbsPath = getMultiCamVideoPath(meta, forceTranscodedVideo);
    } else if ((meta.transcodedVideoFile && meta.transcodedMisalign) || forceTranscodedVideo) {
      videoAbsPath = npath.join(projectInfo.basePath, meta.transcodedVideoFile);
    }
    command = [
      `${viameConstants.setupScriptAbs} &&`,
      `"${viameConstants.trainingExe}" runner`,
      '-s "input:video_reader:type=vidl_ffmpeg"',
      `-p "${pipelinePath}"`,
      `-s downsampler:target_frame_rate=${meta.fps}`,
    ];
    if (frameRange) {
      command.push(`-s downsampler:start_frame=${frameRange[0]}`);
      command.push(`-s downsampler:end_frame=${frameRange[1]}`);
      const isNative = !meta.originalFps || meta.fps >= meta.originalFps;
      command.push(`-s downsampler:frame_range_is_native=${isNative}`);
      // Transcode/filter pipes: output frames renumbered relative to new range
      // All other pipes: output frames relative to original video
      const renumber = pipeline.type === 'transcode' || pipeline.type === 'filter';
      command.push(`-s downsampler:renumber_frames=${renumber}`);
      command.push(`-s downsampler:adjust_timestamps=${renumber}`);
    }
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
    // Filter image list by frame range if specified
    if (frameRange) {
      imageList = filterImageListByFrameRange(imageList, frameRange);
    }
    const fileData = imageList
      .map((f) => npath.join(meta.originalBasePath, f))
      .join('\n');
    await fs.writeFile(manifestFile, fileData);
    command = [
      `${viameConstants.setupScriptAbs} &&`,
      `"${viameConstants.trainingExe}" runner`,
      `-p "${pipelinePath}"`,
    ];
    if (!stereoOrMultiCam) {
      command.push(`-s input:video_filename="${manifestFile}"`);
      command.push(`-s detector_writer:file_name="${detectorOutput}"`);
      command.push(`-s track_writer:file_name="${trackOutput}"`);
    }
  }

  const DIVE_OUTPUT_PROJECT_DIR = 'DIVE_Jobs_Output';
  const timestamp = (new Date()).toISOString().replace(/[:.]/g, '-');
  const outputDirName = `${runPipelineArgs.pipeline.name}_${runPipelineArgs.datasetId}_${timestamp}`;
  const outputDir = `${npath.join(settings.dataPath, DIVE_OUTPUT_PROJECT_DIR, outputDirName)}`;
  if (pipelineCreatesDatasetMarkers.includes(runPipelineArgs.pipeline.type)) {
    if (outputDir !== jobWorkDir) {
      await fs.mkdir(outputDir, { recursive: true });
    }
  }

  if (runPipelineArgs.pipeline.type === 'filter') {
    command.push(`-s kwa_writer:output_directory="${outputDir}/"`);
    command.push(`-s image_writer:file_name_prefix="${outputDir}/"`);
  }

  let transcodedFilename: string;
  if (runPipelineArgs.pipeline.type === 'transcode') {
    // Note: the output of the pipeline may be HEVC encoded
    transcodedFilename = npath.join(outputDir, `${runPipelineArgs.pipeline.name}_${datasetId}_${timestamp}.mp4`);
    command.push(`-s video_writer:video_filename="${transcodedFilename}"`);
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
      command.push(`-s calibration_reader:file="${meta.multiCam.calibration}"`);
    }
  } else if (pipeline.type === stereoPipelineMarker) {
    throw new Error('Attempting to run a multicam pipeline on non multicam data');
  }

  // Add any custom pipeline parameters
  if (runPipelineArgs.pipelineParams) {
    Object.entries(runPipelineArgs.pipelineParams).forEach(([key, value]) => {
      command.push(`-s ${key}="${value}"`);
    });
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
        // Determine which output files to use
        let finalDetectorOutput = detectorOutput;
        let finalTrackOutput = trackOutput;

        // Filter output CSV by frame range for videos
        if (frameRange && metaType === 'video') {
          if (await fs.pathExists(trackOutput)) {
            finalTrackOutput = await filterCsvByFrameRange(trackOutput, frameRange);
          }
          if (await fs.pathExists(detectorOutput)) {
            finalDetectorOutput = await filterCsvByFrameRange(detectorOutput, frameRange);
          }
        }

        const { meta: newMeta } = await common.ingestDataFiles(settings, datasetId, [finalDetectorOutput, finalTrackOutput], multiOutFiles);
        if (newMeta) {
          meta.attributes = newMeta.attributes;
          await common.saveMetadata(settings, datasetId, meta);
        }

        // Check if this is a calibration pipeline and save the output
        if (pipeline.pipe.toLowerCase().includes('calibrate_cameras')) {
          const files = await fs.readdir(jobWorkDir);
          const calibrationFile = files.find(
            (f) => f.toLowerCase().includes('calibration') && f.endsWith('.json'),
          );
          if (calibrationFile) {
            const calibrationPath = npath.join(jobWorkDir, calibrationFile);
            const savedPath = await common.saveLastCalibration(settings, calibrationPath);
            await common.applyCalibrationToUncalibratedStereoDatasets(settings, savedPath);
          }
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

  if (['filter', 'transcode'].includes(runPipelineArgs.pipeline.type)) {
    const importNewMedia = async (sourceName: string, datasetName: string, code: number) => {
      const importPayload = await common.beginMediaImport(sourceName);
      importPayload.jsonMeta.name = datasetName;
      const conversionJobArgs = await common.finalizeMediaImport(settings, importPayload);
      if (conversionJobArgs.mediaList.length > 0) {
        // Convert the media, directly in this job
        updater({
          ...jobBase,
          body: ['Converting pipeline output...'],
          exitCode: code,
          endTime: new Date(),
        });
        await convertMedia(
          settings,
          conversionJobArgs,
          updater,
          (_key: string, meta: JsonMeta) => sendToRenderer('filter-complete', meta),
          undefined,
          false,
          0,
          jobBase.key,
          outputDir,
        );
      } else {
        sendToRenderer('filter-complete', conversionJobArgs.meta);
      }
    };
    job.on('exit', async (code) => {
      if (code === 0) {
        // Ingest the output into a new dataset
        updater({
          ...jobBase,
          body: ['Creating dataset from output...'],
          exitCode: code,
          endTime: new Date(),
        });
        const datasetName = runPipelineArgs.outputDatasetName ? runPipelineArgs.outputDatasetName : outputDir;
        if (runPipelineArgs.pipeline.type === 'transcode') {
          fs.readdir(outputDir, async (err, entries) => {
            if (err) {
              console.error(`Failed to traverse ${outputDir}.`);
            }
            if (!transcodedFilename) {
              console.error('Could not determine name of output video file.');
            }
            entries.forEach((entry: string) => {
              if (entry.startsWith(`${pipeline.name}_${datasetId}`)) {
                transcodedFilename = npath.join(outputDir, entry);
              }
            });
            await importNewMedia(transcodedFilename, datasetName, code);
          });
          return;
        }
        await importNewMedia(outputDir, datasetName, code);
      }
    });
  }

  return jobBase;
}

/**
 * a node.js implementation of dive_tasks.tasks.export_trained_model
 */
async function exportTrainedPipeline(
  settings: Settings,
  exportTrainedPipelineArgs: ExportTrainedPipeline,
  updater: DesktopJobUpdater,
  validateViamePath: (settings: Settings) => Promise<true | string>,
  viameConstants: ViameConstants,
): Promise<DesktopJob> {
  const { path, pipeline } = exportTrainedPipelineArgs;

  const isValid = await validateViamePath(settings);
  if (isValid !== true) {
    throw new Error(isValid);
  }

  const exportPipelinePath = npath.join(settings.viamePath, PipelineRelativeDir, 'convert_model_to_onnx.pipe');
  if (!fs.existsSync(npath.join(exportPipelinePath))) {
    throw new Error("Your VIAME version doesn't support ONNX export. You have to update it to a newer version to be able to export models.");
  }

  const modelPipelineDir = npath.parse(pipeline.pipe).dir;
  let weightsPath: string;
  if (fs.existsSync(npath.join(modelPipelineDir, 'yolo.weights'))) {
    weightsPath = npath.join(modelPipelineDir, 'yolo.weights');
  } else {
    throw new Error('Your pipeline has no trained weights (yolo.weights is missing)');
  }

  const jobWorkDir = await createCustomWorkingDirectory(settings, 'OnnxExport', pipeline.name);

  const converterOutput = npath.join(jobWorkDir, 'model.onnx');
  const joblog = npath.join(jobWorkDir, 'runlog.txt');

  const command = [
    `${viameConstants.setupScriptAbs} &&`,
    `"${viameConstants.trainingExe}" runner`,
    `-p "${exportPipelinePath}"`,
    `-s "onnx_convert:model_path=${weightsPath}"`,
    `-s "onnx_convert:onnx_model_prefix=${converterOutput}"`,
  ];

  const job = observeChild(spawn(command.join(' '), {
    shell: viameConstants.shell,
    cwd: jobWorkDir,
  }));

  const jobBase: DesktopJob = {
    key: `pipeline_${job.pid}_${jobWorkDir}`,
    command: command.join(' '),
    jobType: 'export',
    pid: job.pid,
    args: exportTrainedPipelineArgs,
    title: `${exportTrainedPipelineArgs.pipeline.name} to ONNX`,
    workingDir: jobWorkDir,
    datasetIds: [],
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
      if (fs.existsSync(converterOutput)) {
        if (fs.existsSync(path)) {
          fs.unlinkSync(path);
        }
        // We move instead of copying because .onnx files can be huge
        fs.moveSync(converterOutput, path);
      } else {
        console.error('An error occured while creating the ONNX file.');
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
  forceTranscoding?: boolean,
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
  const jobWorkDir = await createWorkingDirectory(settings, jsonMetaList, runTrainingArgs.pipelineName);

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
      if ((meta.transcodedVideoFile && forceTranscoding) || meta.transcodedMisalign) {
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
  const configFilePath = npath.join(settings.viamePath, PipelineRelativeDir, runTrainingArgs.trainingConfig);

  const command = [
    `${viameConstants.setupScriptAbs} &&`,
    `"${viameConstants.trainingExe}" train`,
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

  if (runTrainingArgs.fineTuneModel && runTrainingArgs.fineTuneModel.path) {
    command.push('--init-weights');
    command.push(runTrainingArgs.fineTuneModel.path);
  }

  if (runTrainingArgs.labelText) {
    const labelsPath = `${jobWorkDir}/labels.txt`;
    fs.writeFileSync(labelsPath, runTrainingArgs.labelText);
    command.push('--labels');
    command.push(labelsPath);
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
        await common.processTrainedPipeline(settings, runTrainingArgs, jobWorkDir);
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
  exportTrainedPipeline,
  train,
};
