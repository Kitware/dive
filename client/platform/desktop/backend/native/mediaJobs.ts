import npath from 'path';
import { spawn } from 'child_process';
import fs from 'fs-extra';

import {
  Settings, DesktopJob, FFProbeResults,
  ConversionArgs,
  DesktopJobUpdater,
  CheckMediaResults,
  FFProbeFrameResults,
} from 'platform/desktop/constants';
import { observeChild } from 'platform/desktop/backend/native/processManager';

import { ViameConstants } from 'platform/desktop/backend/native/viame';
import * as common from './common';
import { jobFileEchoMiddleware, spawnResult } from './utils';
import {
  getTranscodedMultiCamType,
} from './multiCamUtils';

const DiveJobManifestName = 'dive_job_manifest.json';

async function checkFrameMisalignment(
  viameConstants: ViameConstants,
  file: string,
): Promise<boolean> {
  const ffprobePath = `${viameConstants.ffmpeg.path.replace('ffmpeg', 'ffprobe')}`;
  const command = [
    viameConstants.ffmpeg.initialization,
    `"${ffprobePath}"`,
    `"${file}"`,
    '-hide_banner',
    '-read_intervals',
    '%+5',
    '-show_entries',
    'frame=best_effort_timestamp_time',
    '-print_format',
    'json',
    '-v',
    'quiet',
  ];
  const result = await spawnResult(command.join(' '), viameConstants.shell);
  if (result.error || result.output === null) {
    throw result.error || 'Error using ffprobe';
  }
  const returnText = result.output;
  const ffprobeJSON: FFProbeFrameResults = JSON.parse(returnText);

  if (ffprobeJSON && ffprobeJSON.frames?.length) {
    let previousTimestamp = -1;
    for (let i = 0; i < ffprobeJSON.frames.length; i += 1) {
      const frame = ffprobeJSON.frames[i];
      if (frame.best_effort_timestamp_time) {
        if (previousTimestamp === frame.best_effort_timestamp_time) {
          return true;
        }
        previousTimestamp = frame.best_effort_timestamp_time;
      }
    }
  }
  return false;
}

async function realignVideoAndAudio(
  viameConstants: ViameConstants,
  file: string,
  workDir: string,
): Promise<string> {
  const ffmpegPath = viameConstants.ffmpeg.path;
  const alignedFile = npath.join(workDir, 'temprealign.mp4');
  const command = [
    viameConstants.ffmpeg.initialization,
    `"${ffmpegPath}"`,
    '-i',
    `"${file}"`,
    '-ss',
    '0',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-c:a',
    'copy',
    `"${alignedFile}"`,
    '-v',
    'quiet',
  ];
  const result = await spawnResult(command.join(' '), viameConstants.shell);
  if (result.error || result.output === null) {
    throw result.error || 'Error using ffmepg';
  }
  return alignedFile;
}

async function checkAndFixFrameAlignment(
  viameConstants: ViameConstants,
  file: string,
  workDir: string,
): Promise<string> {
  if (!await checkFrameMisalignment(viameConstants, file)) {
    return file;
  }
  return realignVideoAndAudio(viameConstants, file, workDir);
}

async function checkMedia(
  viameConstants: ViameConstants,
  file: string,
): Promise<CheckMediaResults> {
  const ffprobePath = `${viameConstants.ffmpeg.path.replace('ffmpeg', 'ffprobe')}`;
  const command = [
    viameConstants.ffmpeg.initialization,
    `"${ffprobePath}"`,
    '-print_format',
    'json',
    '-v',
    'quiet',
    '-show_format',
    '-show_streams',
    `"${file}"`,
  ];
  const result = await spawnResult(command.join(' '), viameConstants.shell);
  if (result.error || result.output === null) {
    throw result.error || 'Error using ffprobe';
  }
  const returnText = result.output;
  const ffprobeJSON: FFProbeResults = JSON.parse(returnText);

  if (ffprobeJSON && ffprobeJSON.streams?.length) {
    const videoStream = ffprobeJSON.streams.filter((el) => el.codec_type === 'video');
    if (videoStream.length === 0 || !videoStream[0].avg_frame_rate) {
      throw Error('FFProbe found that video stream has no avg_frame_rate');
    }

    const originalFpsString = videoStream[0].avg_frame_rate;
    const [dividend, divisor] = originalFpsString.split('/').map((v) => Number.parseInt(v, 10));
    const originalFps = dividend / divisor;
    const websafe = videoStream
      .filter((el) => el.codec_name === 'h264')
      .filter((el) => el.sample_aspect_ratio === '1:1');
    const misAligned = await checkFrameMisalignment(viameConstants, file);

    return { websafe: !!websafe.length && !misAligned, originalFps, originalFpsString };
  }
  throw Error(`FFProbe did not return a valid value for ${file}`);
}

async function convertMedia(settings: Settings,
  args: ConversionArgs,
  updater: DesktopJobUpdater,
  viameConstants: ViameConstants,
  mediaIndex = 0,
  key = '',
  baseWorkDir = ''): Promise<DesktopJob> {
  // Image conversion needs to utilize the baseWorkDir, init or vids create their own directory
  const jobWorkDir = baseWorkDir || await common.createKwiverRunWorkingDir(settings, [args.meta], 'conversion');
  const joblog = npath.join(jobWorkDir, 'runlog.txt');
  const commands = [];

  let multiType = '';
  if (args.meta.type === 'multi' && mediaIndex < args.mediaList.length) {
    multiType = getTranscodedMultiCamType(args.mediaList[mediaIndex][1], args.meta);
  }
  commands.push(
    viameConstants.ffmpeg.initialization,
    `"${viameConstants.ffmpeg.path}"`,
    `-i "${args.mediaList[mediaIndex][0]}"`,
  );
  if ((args.meta.type === 'video' || multiType === 'video') && mediaIndex < args.mediaList.length) {
    commands.push(
      viameConstants.ffmpeg.videoArgs,
    );
  }
  commands.push(
    `"${args.mediaList[mediaIndex][1]}"`,
  );

  const job = observeChild(spawn(commands.join(' '), { shell: viameConstants.shell }));
  let jobKey = `convert_${job.pid}_${jobWorkDir}`;
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
    workingDir: jobWorkDir,
    datasetIds: [args.meta.id],
    exitCode: job.exitCode,
    startTime: new Date(),
  };

  fs.writeFile(npath.join(jobWorkDir, DiveJobManifestName), JSON.stringify(jobBase));

  job.stdout.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));
  job.stderr.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));

  job.on('exit', async (code) => {
    if (code !== 0) {
      console.error('Error with running conversion');
      updater({
        ...jobBase,
        body: [''],
        exitCode: code,
        endTime: new Date(),
      });
    } else {
      if (args.meta.type === 'video' || multiType === 'video') {
        const updatedFile = await checkAndFixFrameAlignment(
          viameConstants,
          args.mediaList[mediaIndex][1],
          jobWorkDir,
        );
        if (updatedFile !== args.mediaList[mediaIndex][1]) {
          //We need to copy over and replace the media File to the properly updated file.
          await fs.move(updatedFile, args.mediaList[mediaIndex][1], { overwrite: true });
        }
      }

      if (mediaIndex === args.mediaList.length - 1) {
        common.completeConversion(settings, args.meta.id, jobKey);
        updater({
          ...jobBase,
          body: [''],
          exitCode: code,
          endTime: new Date(),
        });
      } else {
        updater({
          ...jobBase,
          body: [`Conversion ${mediaIndex + 1} of ${args.mediaList.length} Complete`],
        });
        convertMedia(settings, args, updater, viameConstants, mediaIndex + 1, jobKey, jobWorkDir);
      }
    }
  });
  return jobBase;
}

export {
  checkMedia,
  convertMedia,
};
