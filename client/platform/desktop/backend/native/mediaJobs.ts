import npath from 'path';
import { spawn } from 'child_process';
import fs from 'fs-extra';


import {
  Settings, DesktopJob,
  ConversionArgs,
  DesktopJobUpdater,
  FFProbeFrameResults,
} from 'platform/desktop/constants';
import { observeChild } from 'platform/desktop/backend/native/processManager';

import {
  jobFileEchoMiddleware, spawnResult, createWorkingDirectory, getBinaryPath,
} from './utils';
// eslint-disable-next-line import/no-cycle
import {
  getTranscodedMultiCamType,
} from './multiCamUtils';

const DiveJobManifestName = 'dive_job_manifest.json';
const VideoArgs = [
  '-c:v', 'libx264',
  '-preset', 'slow',
  // https://github.com/Kitware/dive/issues/855
  '-crf', '22',
  // https://askubuntu.com/questions/1315697/could-not-find-tag-for-codec-pcm-s16le-in-stream-1-codec-not-currently-support
  '-c:a', 'aac',
  /**
   * References:
   * https://github.com/Kitware/dive/pull/602 (Anamorphic Video Support)
   * https://video.stackexchange.com/questions/20871/how-do-i-convert-anamorphic-hdv-video-to-normal-h-264-video-with-ffmpeg-how-to
   */
  '-vf', 'scale=round(iw*sar/2)*2:round(ih/2)*2,setsar=1',
];

const ffmpegPath = getBinaryPath('ffmpeg-ffprobe-static/ffmpeg');
const ffprobePath = getBinaryPath('ffmpeg-ffprobe-static/ffprobe');

interface FFProbeResults {
  streams?: [{
    avg_frame_rate?: string;
    r_frame_rate?: string;
    codec_type?: string;
    codec_name?: string;
    sample_aspect_ratio?: string;
    width?: number;
    height?: number;
  }];
}

interface CheckMediaResults {
  websafe: boolean;
  originalFpsString: string;
  originalFps: number;
  videoDimensions: { width: number; height: number };
}

async function checkFrameMisalignment(file: string): Promise<boolean> {
  const args = [
    file,
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
  const result = await spawnResult(ffprobePath, args);
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

async function realignVideoAndAudio(file: string, workDir: string): Promise<string> {
  const alignedFile = npath.join(workDir, 'temprealign.mp4');
  const args = [
    '-i', file,
    '-ss', '0',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-c:a', 'copy',
    alignedFile,
    '-v', 'quiet',
  ];
  const result = await spawnResult(ffmpegPath, args);
  if (result.error || result.output === null) {
    throw result.error || 'Error using ffmepg';
  }
  return alignedFile;
}

async function checkAndFixFrameAlignment(file: string, workDir: string): Promise<string> {
  if (!await checkFrameMisalignment(file)) {
    return file;
  }
  return realignVideoAndAudio(file, workDir);
}

async function checkMedia(file: string): Promise<CheckMediaResults> {
  const args = [
    '-print_format',
    'json',
    '-v',
    'quiet',
    '-show_format',
    '-show_streams',
    file,
  ];
  const result = await spawnResult(ffprobePath, args);
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
    const videoDimensions = {
      width: videoStream[0].width || 0,
      height: videoStream[0].height || 0,
    };
    const misAligned = await checkFrameMisalignment(file);

    return {
      websafe: !!websafe.length && !misAligned,
      originalFps,
      originalFpsString,
      videoDimensions,
    };
  }
  throw Error(`FFProbe did not return a valid value for ${file}`);
}

async function convertMedia(
  settings: Settings,
  args: ConversionArgs,
  updater: DesktopJobUpdater,
  onComplete?: (jobKey: string) => void,
  mediaIndex = 0,
  key = '',
  baseWorkDir = '',
): Promise<DesktopJob> {
  // Image conversion needs to utilize the baseWorkDir, init or vids create their own directory
  const jobWorkDir = baseWorkDir || await createWorkingDirectory(settings, [args.meta], 'conversion');
  const joblog = npath.join(jobWorkDir, 'runlog.txt');
  const ffmpegArgs: string[] = [];

  let multiType = '';
  if (args.meta.type === 'multi' && mediaIndex < args.mediaList.length) {
    multiType = getTranscodedMultiCamType(args.mediaList[mediaIndex][1], args.meta);
  }
  ffmpegArgs.push('-i', args.mediaList[mediaIndex][0]);
  if ((args.meta.type === 'video' || multiType === 'video') && mediaIndex < args.mediaList.length) {
    ffmpegArgs.push(...VideoArgs);
  }
  ffmpegArgs.push(args.mediaList[mediaIndex][1]);

  const job = observeChild(spawn(ffmpegPath, ffmpegArgs, { shell: false }));
  let jobKey = `convert_${job.pid}_${jobWorkDir}`;
  if (key.length) {
    jobKey = key;
  }
  const jobBase: DesktopJob = {
    key: jobKey,
    pid: job.pid,
    command: [ffmpegPath, ...ffmpegArgs].join(' '),
    args,
    title: `converting ${args.meta.name}`,
    jobType: 'conversion',
    workingDir: jobWorkDir,
    datasetIds: [args.meta.id],
    exitCode: job.exitCode,
    startTime: new Date(),
  };

  fs.writeFile(npath.join(jobWorkDir, DiveJobManifestName), JSON.stringify(jobBase, null, 2));

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
          args.mediaList[mediaIndex][1],
          jobWorkDir,
        );
        if (updatedFile !== args.mediaList[mediaIndex][1]) {
          //We need to copy over and replace the media File to the properly updated file.
          await fs.move(updatedFile, args.mediaList[mediaIndex][1], { overwrite: true });
        }
      }

      if (mediaIndex === args.mediaList.length - 1) {
        if (onComplete) { onComplete(jobKey); }
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
        convertMedia(settings, args, updater, onComplete, mediaIndex + 1, jobKey, jobWorkDir);
      }
    }
  });
  return jobBase;
}

export {
  checkMedia,
  convertMedia,
};
