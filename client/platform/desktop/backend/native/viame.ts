import npath from 'path';
import { spawn } from 'child_process';
import fs from 'fs-extra';

import {
  Settings, DesktopJob, RunPipeline, RunTraining,
  DesktopJobUpdater,
  ExportTrainedPipeline,
  JsonConfig,
  JobsOutputFolderName,
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
} from 'dive-common/constants';
import { parseCompositeDatasetId } from 'dive-common/compositeDatasetId';
import { orderedMultiCamCameraNames } from 'dive-common/multicamDisplay';
import {
  isDisparityImagePipeline,
  isFilterPipeline,
  isTranscodePipeline,
  pipelineCreatesNewDataset,
} from 'dive-common/pipelineCreatesDataset';
import * as common from './common';
import {
  jobFileEchoMiddleware, createWorkingDirectory, createCustomWorkingDirectory, splitExt,
  buildTrainingExitManifest,
} from './utils';
import { buildRegistrationPipelineArgs, ingestPipelineRegistration } from './cameraRegistration';
import {
  getMultiCamImageFiles, getMultiCamVideoPath,
  writeMultiCamStereoPipelineArgs,
} from './multiCamUtils';

const PipelineRelativeDir = 'configs/pipelines';
const DiveJobManifestName = 'dive_job_manifest.json';

// Calibration consumers every stereo pipe is assumed to have unless it declares
// its own via a `# Calibration Keys:` header.
// Keep in sync with server/dive_tasks/multicam_pipeline.py DEFAULT_CALIBRATION_KEYS.
const DEFAULT_CALIBRATION_KEYS = ['measurer:calibration_file', 'calibration_reader:file'] as const;

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
  /** Basename of unified VIAME CLI in `bin/` (e.g. `viame` or `viame.exe`). */
  viameExe: string;
  shell: string | boolean; // shell arg for spawn
}

/**
 * Import newly created media as a new dataset.
 * Should be called after a transcode or filter pipeline runs.
 * @param sourceName
 * The location (directory for images, file for video) of data to be
 * imported.
 * @param datasetName
 * The name of the dataset to be created from the imported data.
 * @param code
 * The exit code of the job that created the data to be imported.
 * @param settings
 * @param updater
 * The job updater function. Used to log additional messages to the
 * DesktopJob log
 * @param jobBase
 * The DesktopJob to update
 * @param outputDir
 * If new data must be converted, this is used as the baseWorkDir
 * for the conversion
 */
async function importNewMedia(
  sourceName: string,
  datasetName: string,
  code: number,
  settings: Settings,
  updater: DesktopJobUpdater,
  jobBase: DesktopJob,
  outputDir: string,
): Promise<void> {
  if (code !== 0) {
    return;
  }
  const importPayload = await common.beginMediaImport(sourceName);
  importPayload.jsonConfig.name = datasetName;
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
      (_key: string, meta: JsonConfig) => sendToRenderer('filter-complete', meta),
      undefined,
      false,
      0,
      jobBase.key,
      outputDir,
    );
  } else {
    sendToRenderer('filter-complete', conversionJobArgs.meta);
  }
}

/**
 * a node.js implementation of dive_tasks.tasks.run_pipeline
 */
/**
 * The input1..N camera order for a 2-cam/3-cam run: the order the user
 * confirmed in the camera-assignment step (validated against the dataset's
 * cameras), else the dataset's camera order as stored.
 */
function multiCamOrderFor(meta: JsonConfig, confirmed?: string[]): string[] {
  const cameras = orderedMultiCamCameraNames(meta.multiCam);
  if (!confirmed?.length) {
    return cameras;
  }
  if ([...confirmed].sort().join('\n') !== [...cameras].sort().join('\n')) {
    throw new Error(`Camera assignment [${confirmed.join(', ')}] does not match the dataset cameras [${cameras.join(', ')}]`);
  }
  return confirmed;
}

async function runPipeline(
  settings: Settings,
  runPipelineArgs: RunPipeline,
  updater: DesktopJobUpdater,
  validateViamePath: (settings: Settings) => Promise<true | string>,
  viameConstants: ViameConstants,
  forceTranscodedVideo?: boolean,
): Promise<DesktopJob> {
  const { datasetId, pipeline } = runPipelineArgs;
  const frameRange = runPipelineArgs.pipelineParams?.runtimeParams?.frameRange ?? undefined;
  const imagePairs = runPipelineArgs.pipelineParams?.runtimeParams?.imagePairs ?? undefined;
  // Pipes with a camera suffix (e.g. filter_register_frames_2-cam.pipe) are
  // categorized under '2-cam'/'3-cam' rather than by their filename prefix,
  // so output handling is recognized from the pipe filename as well as the type.
  const createsNewDataset = pipelineCreatesNewDataset(pipeline);
  const isFilterPipe = isFilterPipeline(pipeline);
  const isTranscodePipe = isTranscodePipeline(pipeline);
  const isDisparityPipe = isDisparityImagePipeline(pipeline);
  const outputDatasetName = runPipelineArgs.outputDatasetName
    ?? runPipelineArgs.pipelineParams?.outputDatasetName;

  const isValid = await validateViamePath(settings);
  if (isValid !== true) {
    throw new Error(isValid);
  }

  let pipelinePath = npath.join(settings.viamePath, PipelineRelativeDir, pipeline.pipe);
  if (runPipelineArgs.pipeline.type === 'trained') {
    pipelinePath = pipeline.pipe;
  }
  const projectInfo = await common.getValidatedProjectDir(settings, datasetId);
  const meta = await common.loadJsonConfig(projectInfo.datasetFileAbsPath);
  // Name the job folder after the pipe that actually ran, not pipeline.name --
  // that is a display label the pipeline list reconstructs from this very
  // filename (underscores to spaces, hyphens lost to cleanString), so routing
  // it back into a path is a lossy round trip. splitExt also drops the
  // directory, which matters because a 'trained' pipeline's .pipe is a full
  // path rather than a bare filename.
  const jobWorkDir = await createWorkingDirectory(settings, [meta], splitExt(pipeline.pipe)[0]);

  // The key must not depend on the pid: the renderer is told this job exists
  // before any process does, so that preparing the inputs (extracting a
  // multi-camera frame subset from video takes longer than the pipeline run
  // itself) shows up in the Jobs tab instead of looking like nothing
  // happened. Both updates have to land on the same history entry, and
  // jobWorkDir is already unique per run.
  const jobKey = `pipeline_${jobWorkDir}`;
  const preparingJob: DesktopJob = {
    key: jobKey,
    command: '',
    jobType: 'pipeline',
    // No process yet. The UI reads a negative pid as "still starting" and
    // leaves it out of the job's detail table.
    pid: -1,
    args: runPipelineArgs,
    title: runPipelineArgs.pipeline.name,
    workingDir: jobWorkDir,
    datasetIds: [datasetId],
    exitCode: null,
    startTime: new Date(),
  };
  const reportPreparing = (message: string) => updater({ ...preparingJob, body: [message] });
  // Closes out the placeholder entry when the job dies before it ever spawns;
  // otherwise the Jobs tab keeps a job that can never finish, and its badge
  // spins forever.
  const failedToStart = (err: unknown) => {
    updater({
      ...preparingJob,
      body: [`Job failed to start: ${err instanceof Error ? err.message : String(err)}`],
      exitCode: 1,
      endTime: new Date(),
    });
  };
  reportPreparing('Preparing job inputs...');

  const { parentId, cameraName } = parseCompositeDatasetId(datasetId);
  let cameraLogLine: string | null = null;
  if (cameraName) {
    try {
      const parentInfo = await common.getValidatedProjectDir(settings, parentId);
      const parentMeta = await common.loadJsonConfig(parentInfo.datasetFileAbsPath);
      const defaultDisplay = parentMeta.multiCam?.defaultDisplay;
      if (cameraName !== defaultDisplay) {
        cameraLogLine = `Running pipeline on camera: ${cameraName}`;
      }
    } catch {
      cameraLogLine = `Running pipeline on camera: ${cameraName}`;
    }
  }

  const timestamp = (new Date()).toISOString().replace(/[:.]/g, '-');
  const outputDirName = `${runPipelineArgs.pipeline.name}_${runPipelineArgs.datasetId}_${timestamp}`;
  const outputDir = `${npath.join(settings.dataPath, JobsOutputFolderName, outputDirName)}`;
  if (createsNewDataset) {
    if (outputDir !== jobWorkDir) {
      await fs.mkdir(outputDir, { recursive: true });
    }
  }

  const detectorOutputFileName = 'detector_output.csv';
  const trackOutputFileName = 'track_output.csv';
  let trackOutput: string;
  let detectorOutput: string;
  if (createsNewDataset) {
    detectorOutput = npath.join(outputDir, detectorOutputFileName);
    trackOutput = npath.join(outputDir, trackOutputFileName);
  } else {
    detectorOutput = npath.join(jobWorkDir, detectorOutputFileName);
    trackOutput = npath.join(jobWorkDir, trackOutputFileName);
  }
  const joblog = npath.join(jobWorkDir, 'runlog.txt');

  //TODO: TEMPORARY FIX FOR DEMO PURPOSES
  // Disparity image pipe is measurement_* but only needs stereo media + calibration.
  let requiresInput = false;
  if (
    !isDisparityPipe
    && (/utility_|filter_|transcode_|measurement_/g).test(pipeline.pipe)
  ) {
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
  // Input image list(s) so opt-in pipes (sea-lion registration) can read the same
  // lists DIVE feeds the input reader — one single-file, line-separated list per
  // camera (single-cam: one entry).
  let inputImageLists: string[] = [];

  if (metaType === 'video') {
    let videoAbsPath = npath.join(meta.originalBasePath, meta.originalVideoFile);
    if (meta.type === MultiType) {
      videoAbsPath = getMultiCamVideoPath(meta, forceTranscodedVideo);
    } else if ((meta.transcodedVideoFile && meta.transcodedMisalign) || forceTranscodedVideo) {
      videoAbsPath = npath.join(projectInfo.basePath, meta.transcodedVideoFile);
    }
    command = [
      `${viameConstants.setupScriptAbs} &&`,
      `"${viameConstants.viameExe}" runner`,
      '-s "input:video_reader:type=vidl_ffmpeg"',
      `-p "${pipelinePath}"`,
      `-s downsampler:target_frame_rate=${meta.fps}`,
    ];
    if (frameRange) {
      command.push(`-s downsampler:start_frame=${frameRange[0]}`);
      command.push(`-s downsampler:end_frame=${frameRange[1]}`);
      const isNative = !meta.originalFps || meta.fps >= meta.originalFps;
      command.push(`-s downsampler:frame_range_is_native=${isNative}`);
      // Transcode/filter/disparity pipes: output frames renumbered relative to new range
      // All other pipes: output frames relative to original video
      const renumber = isTranscodePipe || isFilterPipe || isDisparityPipe;
      command.push(`-s downsampler:renumber_frames=${renumber}`);
      command.push(`-s downsampler:adjust_timestamps=${renumber}`);
    }
    if (!stereoOrMultiCam) {
      command.push(`-s input:video_filename="${videoAbsPath}"`);
      command.push(`-s detector_writer:file_name="${detectorOutput}"`);
      command.push(`-s track_writer:file_name="${trackOutput}"`);
      inputImageLists = [videoAbsPath];
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
      `"${viameConstants.viameExe}" runner`,
      `-p "${pipelinePath}"`,
    ];
    if (!stereoOrMultiCam) {
      command.push(`-s input:video_filename="${manifestFile}"`);
      command.push(`-s detector_writer:file_name="${detectorOutput}"`);
      command.push(`-s track_writer:file_name="${trackOutput}"`);
      inputImageLists = [manifestFile];
    }
  }

  if (isFilterPipe) {
    command.push(`-s kwa_writer:output_directory="${outputDir}/"`);
    // Multicam filter pipes have one writer per camera (image_writer,
    // image_writer2, image_writer3); extra -s keys for absent processes are
    // ignored by the runner.
    command.push(`-s image_writer:file_name_prefix="${outputDir}/"`);
    command.push(`-s image_writer2:file_name_prefix="${outputDir}/"`);
    command.push(`-s image_writer3:file_name_prefix="${outputDir}/"`);
  }

  // Disparity pipe writes via process `output` with file_name_template.
  // Override that key directly: $CONFIG{global:...} expands at parse time and
  // would ignore a -s on global:output_depths_directory.
  if (isDisparityPipe) {
    command.push(
      `-s output:file_name_template="${outputDir}/map%06d.png"`,
    );
  }

  let transcodedFilename: string;
  if (isTranscodePipe) {
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
    const isMultiCamPipeline = multiCamPipelineMarkers.includes(pipeline.type);
    // 2-cam/3-cam pipes: which camera feeds which inputN is the order the
    // user confirmed before the run.
    const multiCamOrder = isMultiCamPipeline
      ? multiCamOrderFor(meta, runPipelineArgs.pipelineParams?.cameraOrder)
      : undefined;
    const { argFilePair, outFiles } = await writeMultiCamStereoPipelineArgs(
      jobWorkDir,
      meta,
      settings,
      requiresInput,
      false,
      multiCamOrder,
      {
        imagePairs,
        frameRange,
        onProgress: reportPreparing,
      },
    );
    Object.entries(argFilePair).forEach(([arg, file]) => {
      command.push(`-s ${arg}="${file}"`);
    });
    // One image list per camera (each a single line-separated file).
    const orderedInputManifests = Object.keys(argFilePair)
      .filter((arg) => /^input\d+:video_filename$/.test(arg))
      .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10))
      .map((arg) => argFilePair[arg]);
    if (orderedInputManifests.length) {
      inputImageLists = orderedInputManifests;
    }
    multiOutFiles = {};
    Object.entries(outFiles).forEach(([cameraName, fileName]) => {
      multiOutFiles[cameraName] = npath.join(jobWorkDir, fileName);
    });
    trackOutput = npath.join(jobWorkDir, outFiles[meta.multiCam.defaultDisplay]);

    if (meta.multiCam.calibration) {
      // A pipe whose calibration consumer is not the conventional
      // `measurer`/`calibration_reader` names its own keys via `# Calibration Keys:`.
      const calibrationKeys = runPipelineArgs.pipeline.metadata?.calibrationKeys?.length
        ? runPipelineArgs.pipeline.metadata.calibrationKeys
        : DEFAULT_CALIBRATION_KEYS;
      calibrationKeys.forEach((key) => {
        command.push(`-s ${key}="${meta.multiCam?.calibration}"`);
      });
    }

    if (pipeline.pipe.toLowerCase().includes('align_cameras')) {
      // Camera names for the output JSON, aligned with the input{i} order
      // writeMultiCamStereoPipelineArgs uses (multiCamOrder or cameraOrder).
      const cameraNames = (multiCamOrder ?? orderedMultiCamCameraNames(meta.multiCam)).join(',');
      command.push(`-s register:camera_names="${cameraNames}"`);
      command.push(`-s register:output_directory="${jobWorkDir}"`);
    }
    if (multiCamOrder) {
      // Hand the camera registration to the pipeline's warp processes; a
      // warped camera with no registration onto camera 1 fails here, before
      // the job exists.
      const registrationArgs = await buildRegistrationPipelineArgs(
        settings,
        meta,
        jobWorkDir,
        multiCamOrder,
        pipeline.metadata?.registrationWarps,
        pipeline.name,
      );
      Object.entries(registrationArgs).forEach(([arg, value]) => {
        command.push(`-s ${arg}="${value}"`);
      });
    }
  } else if (pipeline.type === stereoPipelineMarker) {
    throw new Error('Attempting to run a multicam pipeline on non multicam data');
  }

  // Hand the dataset's optional metadata file to pipelines that opt in via a
  // `# Metadata File: <block>:<key>` header (e.g. sea-lion stabilizer:flight_log).
  const metadataFileKey = runPipelineArgs.pipeline.metadata?.metadataFileKey;
  if (metadataFileKey && meta.metadataFile) {
    command.push(`-s ${metadataFileKey}="${meta.metadataFile}"`);
  }

  // Bind the per-camera input image lists to the keys a pipe declares via
  // `# Image List Keys:`, so the sea-lion registration stabilizer reads the same
  // frames DIVE runs on. A `{cam}` placeholder is expanded per camera (1-based);
  // a key without it gets the first camera's list.
  const { imageListKeys } = runPipelineArgs.pipeline.metadata ?? {};
  if (inputImageLists.length) {
    (imageListKeys ?? []).forEach((key) => {
      if (key.includes('{cam}')) {
        inputImageLists.forEach((imageList, idx) => {
          command.push(`-s ${key.replace('{cam}', String(idx + 1))}="${imageList}"`);
        });
      } else {
        command.push(`-s ${key}="${inputImageLists[0]}"`);
      }
    });
  }

  // Add any custom pipeline parameters
  const kwiverParams = runPipelineArgs.pipelineParams?.kwiverParams;
  if (kwiverParams) {
    const escapeValue = (val: string) => val.replace(/["$]/g, '\\$&');
    Object.entries(kwiverParams).forEach(([key, value]) => {
      command.push(`-s ${key}="${escapeValue(value.toString())}"`);
    });
  }

  const job = observeChild(spawn(command.join(' '), {
    shell: viameConstants.shell,
    cwd: jobWorkDir,
  }));
  if (job.pid === undefined) {
    const err = new Error('Failed to spawn pipeline process');
    failedToStart(err);
    throw err;
  }

  const jobBase: DesktopJob = {
    key: jobKey,
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

  if (cameraLogLine) {
    await fs.appendFile(joblog, `${cameraLogLine}\n`);
  }

  updater({
    ...jobBase,
    body: cameraLogLine ? [cameraLogLine, ''] : [''],
  });

  job.stdout.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));
  job.stderr.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));

  job.on('exit', async (code) => {
    let exitCode = code;
    const bodyText = [''];
    if (code === 0) {
      try {
        if (!createsNewDataset) {
          let finalDetectorOutput = detectorOutput;
          let finalTrackOutput = trackOutput;

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
            await common.saveConfig(settings, datasetId, meta);
          }
        }

        // Registration pipeline: merge the output into the dataset's saved
        // camera registration. Filename sniff is substring-based, like the
        // calibration hook below; the process writes atomically, so a file
        // present here is a complete result (a canceled job leaves none).
        if (pipeline.pipe.toLowerCase().includes('align_cameras')) {
          const files = await fs.readdir(jobWorkDir);
          const registrationFile = files.find(
            (f) => f.toLowerCase().includes('registration') && f.endsWith('.json'),
          );
          if (registrationFile && meta.multiCam) {
            const videoCameras = Object.entries(meta.multiCam.cameras)
              .filter(([, camera]) => camera.type === 'video')
              .map(([name]) => name);
            const summary = await ingestPipelineRegistration(
              settings,
              datasetId,
              npath.join(jobWorkDir, registrationFile),
              videoCameras,
            );
            updater({
              ...jobBase,
              body: [`Merged camera registration for ${summary.pairCount} pair(s) into the dataset`],
            });
          }
        }

        // Check if this is a calibration pipeline and save the output
        if (pipeline.pipe.toLowerCase().includes('calibrate_cameras')) {
          const files = await fs.readdir(jobWorkDir);
          const calibrationFile = files.find(
            (f) => f.toLowerCase().includes('calibration') && f.endsWith('.json'),
          );
          if (calibrationFile) {
            const calibrationPath = npath.join(jobWorkDir, calibrationFile);
            try {
              // Apply calibration directly to the dataset that ran the pipeline
              await common.applyCalibrationToDataset(
                settings,
                datasetId,
                calibrationPath,
              );
              // Also save as last calibration for future imports
              await common.saveLastCalibration(settings, calibrationPath);
              // Signal UI to refresh calibration info
              sendToRenderer('calibration-assigned', {
                datasetId,
                calibrationFile,
              });
            } catch (err) {
              console.error(`Failed to apply calibration to dataset ${datasetId}:`, err);
              await fs.appendFile(
                joblog,
                `\nError assigning calibration file to dataset: ${(err as Error).message}`,
              );
            }
          }
        }

        // Check if this is a transcode/filter pipeline and create a new dataset
        if (createsNewDataset) {
          updater({
            ...jobBase,
            body: ['Creating dataset from output...'],
            exitCode: code,
            endTime: new Date(),
          });
          const datasetName = outputDatasetName || outputDir;
          if (isTranscodePipe) {
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
              await importNewMedia(
                transcodedFilename,
                datasetName,
                code,
                settings,
                updater,
                jobBase,
                outputDir,
              );
            });
            return;
          }
          await importNewMedia(
            outputDir,
            datasetName,
            code,
            settings,
            updater,
            jobBase,
            outputDir,
          );
        }
      } catch (err) {
        // Post-run collection (annotation ingest, registration merge, dataset
        // creation) failing used to be swallowed to the main-process console:
        // the job still reported success while its results never reached the
        // dataset, which reads as "the pipeline did nothing". Put it where the
        // user looks instead.
        const message = `Post-run processing failed: ${err instanceof Error ? err.message : String(err)}`;
        console.error(err);
        await fs.appendFile(joblog, `\n${message}\n`).catch(() => undefined);
        exitCode = 1;
        bodyText.unshift(message);
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
  const extensions = ['.weights', '.ckpt', '.pth'];
  let weightsPath: string | undefined;

  const files = fs.readdirSync(modelPipelineDir);

  const foundExtension = extensions.find(
    (ext) => files.some((file) => file.toLowerCase().endsWith(ext)),
  );

  if (foundExtension) {
    const fileName = files.find((file) => file.toLowerCase().endsWith(foundExtension));
    if (fileName) {
      weightsPath = npath.join(modelPipelineDir, fileName);
    }
  }

  if (!weightsPath) {
    throw new Error(`No weights path (${extensions.join(', ')}) found.`);
  }

  const pipeSegment = splitExt(pipeline.pipe)[0];
  const jobWorkDir = await createCustomWorkingDirectory(settings, 'OnnxExport', pipeSegment);

  const converterOutput = npath.join(jobWorkDir, 'model.onnx');
  const joblog = npath.join(jobWorkDir, 'runlog.txt');

  const command = [
    `${viameConstants.setupScriptAbs} &&`,
    `"${viameConstants.viameExe}" runner`,
    `-p "${exportPipelinePath}"`,
    `-s "onnx_convert:model_path=${weightsPath}"`,
    `-s "onnx_convert:onnx_model_prefix=${converterOutput}"`,
  ];

  const job = observeChild(spawn(command.join(' '), {
    shell: viameConstants.shell,
    cwd: jobWorkDir,
  }));
  if (job.pid === undefined) {
    throw new Error('Failed to spawn export process');
  }

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

  const resumeDir = runTrainingArgs.resumeWorkingDir;
  let jobWorkDir: string;
  if (resumeDir) {
    /* Continue an interrupted run: its input lists, groundtruth files, and
     * intermediate trainer state are already in the working directory. */
    if (!fs.existsSync(npath.join(resumeDir, DiveJobManifestName))) {
      throw new Error(`Cannot resume training: no job manifest found in ${resumeDir}`);
    }
    jobWorkDir = resumeDir;
  } else {
    /* Zip together project info and meta */
    const infoAndMeta = await Promise.all(
      runTrainingArgs.datasetIds.map(async (id) => {
        const projectInfo = await common.getValidatedProjectDir(settings, id);
        const meta = await common.loadJsonConfig(projectInfo.datasetFileAbsPath);
        return { projectInfo, meta };
      }),
    );
    const jsonConfigList = infoAndMeta.map(({ meta }) => meta);

    // Working dir for training
    jobWorkDir = await createWorkingDirectory(settings, jsonConfigList, runTrainingArgs.pipelineName);

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
    const groundtruthFile = fs.createWriteStream(npath.join(jobWorkDir, 'input_truth_list.txt'));
    groundtruthFilenames.forEach((name) => groundtruthFile.write(`${name}\n`));
    groundtruthFile.end();

    // Write input folder paths to list
    const inputFile = fs.createWriteStream(npath.join(jobWorkDir, 'input_folder_list.txt'));
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
  }

  // Argument files for training
  const inputFolderFileList = npath.join(jobWorkDir, 'input_folder_list.txt');
  const groundTruthFileList = npath.join(jobWorkDir, 'input_truth_list.txt');
  if (resumeDir && !(fs.existsSync(inputFolderFileList) && fs.existsSync(groundTruthFileList))) {
    throw new Error(`Cannot resume training: input lists are missing from ${resumeDir}`);
  }

  const joblog = npath.join(jobWorkDir, 'runlog.txt');
  const configFilePath = npath.join(settings.viamePath, PipelineRelativeDir, runTrainingArgs.trainingConfig);

  const command = [
    `${viameConstants.setupScriptAbs} &&`,
    `"${viameConstants.viameExe}" train`,
    `--input-list "${inputFolderFileList}"`,
    `--input-truth "${groundTruthFileList}"`,
    `--config "${configFilePath}"`,
    '--no-query',
    '--no-adv-prints',
  ];

  if (resumeDir) {
    command.push('--continue');
  }

  if (runTrainingArgs.annotatedFramesOnly) {
    command.push('--gt-frames-only');
  }

  // On resume, --continue restores the run's own checkpoint; re-seeding with
  // the fine-tune weights would override it
  if (!resumeDir && runTrainingArgs.fineTuneModel && runTrainingArgs.fineTuneModel.path) {
    command.push('--init-weights');
    command.push(runTrainingArgs.fineTuneModel.path);
  }

  if (runTrainingArgs.labelText) {
    const labelsPath = `${jobWorkDir}/labels.txt`;
    if (!resumeDir) {
      fs.writeFileSync(labelsPath, runTrainingArgs.labelText);
    }
    command.push('--labels');
    command.push(labelsPath);
  }

  const job = observeChild(spawn(command.join(' '), {
    shell: viameConstants.shell,
    cwd: jobWorkDir,
  }));
  if (job.pid === undefined) {
    throw new Error('Failed to spawn training process');
  }

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
    const manifestPath = npath.join(jobWorkDir, DiveJobManifestName);
    // Cancel updates the manifest before killing the child; read that first so
    // we do not clobber cancelledJob with a null/signal exit code.
    let existingManifest: DesktopJob | undefined;
    try {
      if (await fs.pathExists(manifestPath)) {
        existingManifest = await fs.readJson(manifestPath) as DesktopJob;
      }
    } catch {
      // fall through and record process exit status
    }

    let exitCode = code;
    const bodyText = [''];
    if (!existingManifest?.cancelledJob && code === 0) {
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
    const endTime = new Date();
    const finalJob = buildTrainingExitManifest(jobBase, exitCode, endTime, existingManifest);
    // Record the final status so interrupted runs can be detected as resumable
    fs.writeFile(manifestPath, JSON.stringify(finalJob, null, 2));
    updater({
      ...finalJob,
      body: bodyText,
    });
  });
  return jobBase;
}

export {
  runPipeline,
  exportTrainedPipeline,
  train,
  DEFAULT_CALIBRATION_KEYS,
};
