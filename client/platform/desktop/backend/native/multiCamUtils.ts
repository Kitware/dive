/* eslint-disable no-await-in-loop */
import npath from 'path';
import fs from 'fs-extra';
import {
  FrameImage,
  MultiCamMedia,
} from 'dive-common/apispec';

import { JsonConfig, Settings } from 'platform/desktop/constants';
import { loadAnnotationFile, loadJsonConfig, getValidatedProjectDir } from 'platform/desktop/backend/native/common';
import { serialize } from 'platform/desktop/backend/serializers/viame';
import { parseFrameTimestamp } from 'dive-common/frameTimestamp';
import { getBinaryPath, spawnResult } from './utils';

const ffmpegPath = getBinaryPath('ffmpeg-ffprobe-static/ffmpeg');

/** Frame subset / range inputs for multicam pipeline arg writing. */
export interface MultiCamRuntimeSubset {
  /**
   * Camera name -> ordered image identifiers for exactly the frames a job
   * should process (registration subset jobs). Entries are the camera's own
   * image names (resolved against its base path), absolute paths, or
   * frame://N pseudo-names for video cameras (extracted to temp images).
   */
  imagePairs?: Record<string, string[]>;
  frameRange?: [number, number];
  /**
   * Progress sink for the slow part of writing these args: extracting a video
   * camera's subset frames to stills, which for a rig-wide registration run
   * takes longer than the pipeline itself. Without it the caller has nothing
   * to report between "job accepted" and "process spawned".
   */
  onProgress?: (message: string) => void;
}

/**
 * Extract specific frames of a video to still images so a frame-subset job
 * can consume one uniform image-list input (no vidl_ffmpeg in the pipe, no
 * video-decode variability in the matcher's input). The frame number is
 * kept in the file name (<camera>.frame_<N>.png) so job outputs can be
 * mapped back to frame://N identities on ingest.
 */
async function extractVideoFrames(
  videoPath: string,
  frames: number[],
  fps: number,
  outDir: string,
  camera: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  await fs.ensureDir(outDir);
  const results: string[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const frameNum of frames) {
    const seconds = fps > 0 ? frameNum / fps : 0;
    const dest = npath.join(outDir, `${camera}.frame_${frameNum}.png`);

    const result = await spawnResult(ffmpegPath, [
      '-ss', seconds.toFixed(6),
      '-i', videoPath,
      '-frames:v', '1',
      // Without -update, ffmpeg's image2 muxer treats any digit-bearing
      // output name as an ambiguous sequence pattern and refuses to write
      // it; -update 1 tells it this is one literal file.
      '-update', '1',
      '-y', dest,
    ]);

    // result.error is just accumulated stderr, which ffmpeg always writes
    // (its own progress/banner logging) even on success -- exit code and
    // the output file are the actual success signal.
    if (result.exitCode !== 0 || !await fs.pathExists(dest)) {
      throw new Error(`Could not extract frame ${frameNum} from ${videoPath}: ${result.error || 'no output'}`);
    }
    results.push(dest);
    onProgress?.(results.length, frames.length);
  }
  return results;
}

/** frame://N pseudo-name to frame number, or null for real image names. */
function pseudoFrameNumber(entry: string): number | null {
  const match = /^frame:\/\/(\d+)$/.exec(entry);
  return match ? Number(match[1]) : null;
}

/**
 * Figure out the destination location
 */
function transcodeMultiCam(
  jsonConfig: JsonConfig,
  item: string,
  projectDirAbsPath: string,
) {
  let destLoc = '';
  if (jsonConfig.multiCam) {
    const entries = Object.entries(jsonConfig.multiCam.cameras);
    for (let i = 0; i < entries.length; i += 1) {
      const [cameraName, cameraData] = entries[i];
      if (cameraData.imageListPath) {
        throw new Error('transcoding is not supported for image lists');
      }
      if (item.includes(cameraData.originalBasePath)) {
        const extension = cameraData.type === 'video' ? '.mp4' : '.png';
        destLoc = item.replace(npath.extname(item), extension);

        if (cameraData.type === 'image-sequence') {
          if (!cameraData.transcodedImageFiles) {
            cameraData.transcodedImageFiles = [];
          }
          if (cameraData.originalImageFiles.includes(npath.basename(item))) {
            destLoc = destLoc.replace(cameraData.originalBasePath, `${projectDirAbsPath}/${cameraName}`);
            cameraData.transcodedImageFiles.push(npath.basename(destLoc));
            break;
          }
        } else if (cameraData.type === 'video') {
          if (item === npath.join(cameraData.originalBasePath, cameraData.originalVideoFile)) {
            destLoc = destLoc.replace(cameraData.originalBasePath, `${projectDirAbsPath}/${cameraName}`);
            cameraData.transcodedVideoFile = npath.basename(destLoc);
            break;
          }
        }
      }
    }
  }
  return destLoc;
}

function getTranscodedMultiCamType(imageListFile: string, jsonConfig: JsonConfig) {
  // Look through cameras trying to find the match for the key/name and type to return back the type
  if (jsonConfig.multiCam) {
    const base = npath.basename(imageListFile).replace(npath.extname(imageListFile), '');
    let type;
    Object.values(jsonConfig.multiCam.cameras).forEach((val) => {
      if (val.originalImageFiles.map((item) => item.replace(npath.extname(item), '')).includes(base)) {
        type = val.type;
      }
      if (val.originalVideoFile.includes(base)) {
        type = val.type;
      }
    });
    if (type) {
      return type;
    }
  }
  throw new Error(`No associate type for ${imageListFile} in multiCam data`);
}

async function writeMultiCamStereoPipelineArgs(
  jobWorkDir: string,
  meta: JsonConfig,
  settings: Settings,
  utility = false,
  forceTranscoded = false,
  runtime: MultiCamRuntimeSubset = {},
) {
  const { onProgress } = runtime;
  const argFilePair: Record<string, string> = {};
  const outFiles: Record<string, string> = {};
  if (meta.multiCam && meta.multiCam.cameras) {
    const cameraList = Object.entries(meta.multiCam.cameras);
    for (let i = 0; i < cameraList.length; i += 1) {
      const [key, list] = cameraList[i];
      const { originalBasePath } = list;
      const outputFileName = `computed_tracks_${key}.csv`;
      const outputArg = `detector_writer${i + 1}:file_name`;
      const outputArgWriteTracks = `track_writer${i + 1}:file_name`;
      argFilePair[outputArg] = outputFileName;
      argFilePair[outputArgWriteTracks] = outputFileName;
      outFiles[key] = outputFileName;
      const inputArg = `input${i + 1}:video_filename`;
      if (i === 0) {
        argFilePair['detector_writer:file_name'] = outputFileName;
        argFilePair['track_writer:file_name'] = outputFileName;
      }
      const subset = runtime.imagePairs?.[key];
      if (list.type === 'image-sequence') {
        const inputFileName = npath.join(jobWorkDir, `input${i + 1}_images.txt`);
        let images = list.originalImageFiles.map((image) => npath.join(originalBasePath, image));
        if (subset) {
          // A registration subset job: ONLY the selected frames, keeping the
          // ordering contract (row i of each camera's list pairs with row i
          // of every other camera's).
          images = subset.map((entry) => (
            npath.isAbsolute(entry) ? entry : npath.join(originalBasePath, entry)));
        } else if (runtime.frameRange) {
          // The single-camera path filters image lists by frameRange;
          // multicam silently ignored it (a pre-existing no-op) -- apply it
          // here now that the list writing is subset-aware.
          const [startFrame, endFrame] = runtime.frameRange;
          images = images.slice(Math.max(0, startFrame), endFrame + 1);
        }
        const inputFile = fs.createWriteStream(inputFileName);
        images.forEach((image) => inputFile.write(`${image}\n`));
        inputFile.end();
        argFilePair[inputArg] = inputFileName;
        if (i === 0) {
          argFilePair['input:video_filename'] = inputFileName;
        }
      } else if (list.originalVideoFile && subset) {
        // Video multicam with a frame subset: extract the selected frames to
        // temp images and feed the identical image-list path, so the
        // register pipes never need vidl_ffmpeg (one input mechanism, both
        // media types).
        const vidFile = (list.transcodedVideoFile && forceTranscoded) || list.transcodedMisalign
          ? list.transcodedVideoFile : list.originalVideoFile;
        const videoPath = npath.join(originalBasePath, vidFile);
        const frames = subset.map((entry) => {
          const frameNum = pseudoFrameNumber(entry);
          if (frameNum === null) {
            throw new Error(`Expected frame://N identifiers for video camera "${key}", got "${entry}"`);
          }
          return frameNum;
        });
        const extracted = await extractVideoFrames(
          videoPath,
          frames,
          meta.fps,
          npath.join(jobWorkDir, `extracted_${key}`),
          key,
          (done, total) => onProgress?.(`Extracting frames from ${key}: ${done}/${total}`),
        );
        const inputFileName = npath.join(jobWorkDir, `input${i + 1}_images.txt`);
        const inputFile = fs.createWriteStream(inputFileName);
        extracted.forEach((image) => inputFile.write(`${image}\n`));
        inputFile.end();
        argFilePair[inputArg] = inputFileName;
        if (i === 0) {
          argFilePair['input:video_filename'] = inputFileName;
        }
      } else if (list.originalVideoFile) {
        const vidFile = (list.transcodedVideoFile && forceTranscoded) || list.transcodedMisalign
          ? list.transcodedVideoFile : list.originalVideoFile;
        const vidTypeArg = `input${i + 1}:video_reader:type`;
        const vidType = 'vidl_ffmpeg';
        argFilePair[vidTypeArg] = vidType;
        const videoFileName = npath.join(originalBasePath, vidFile);
        argFilePair[inputArg] = videoFileName;
        if (i === 0) {
          argFilePair['input:video_filename'] = videoFileName;
        }
      }
      if (utility) {
        const inputArgDetection = `detection_reader${i + 1}:file_name`;
        const inputArgTrack = `track_reader${i + 1}:file_name`;
        const groundTruthFileName = npath.join(jobWorkDir, `detections${i + 1}.csv`);
        // We need to download these files with the proper names
        const projectDirInfo = await getValidatedProjectDir(settings, `${meta.id}/${key}`);
        const groundTruthFileStream = fs.createWriteStream(groundTruthFileName);
        argFilePair[inputArgTrack] = groundTruthFileName;
        argFilePair[inputArgDetection] = groundTruthFileName;
        if (i === 0) {
          argFilePair['detection_reader:file_name'] = groundTruthFileName;
          argFilePair['track_reader:file_name'] = groundTruthFileName;
        }
        const subMeta = await loadJsonConfig(projectDirInfo.datasetFileAbsPath);
        const inputData = await loadAnnotationFile(projectDirInfo.trackFileAbsPath);
        await serialize(groundTruthFileStream, inputData, subMeta);
        groundTruthFileStream.end();
      }
    }
  }
  return { argFilePair, outFiles };
}

function getMultiCamUrls(
  projectMetaData: JsonConfig,
  projectBasePath: string,
  makeMediaUrl: (path: string) => string,
) {
  if (projectMetaData.multiCam && projectMetaData.multiCam.defaultDisplay) {
    //Confirm we have a imageList for the display
    const displayCamera = projectMetaData.multiCam.cameras[projectMetaData.multiCam.defaultDisplay];
    if (!displayCamera) {
      throw new Error(`The default display of ${projectMetaData.multiCam.defaultDisplay} is not in the list of cameras`);
    }
    const multiCamMedia: MultiCamMedia = {
      cameras: {},
      defaultDisplay: projectMetaData.multiCam.defaultDisplay,
    };

    Object.entries(projectMetaData.multiCam.cameras).forEach(([key, value]) => {
      let imageData = [] as FrameImage[];
      let videoUrl = '';
      if (value.type === 'image-sequence') {
        let displayFilenames = value.originalImageFiles;
        let { originalBasePath } = value;
        // Filter transcoded images to use left/right files)
        if (value.transcodedImageFiles && value.transcodedImageFiles.length) {
          if (value.imageListPath) {
            throw new Error('Impossible state: transcoding is not supported for image lists.');
          }
          displayFilenames = value.transcodedImageFiles;
          originalBasePath = npath.join(projectBasePath, key);
        }
        imageData = displayFilenames.map((filename: string) => ({
          url: makeMediaUrl(npath.join(originalBasePath, filename)),
          filename,
          timestamp: parseFrameTimestamp(filename),
        }));
      } else if (value.type === 'video') {
        let displayFilename = value.originalVideoFile;
        let { originalBasePath } = displayCamera;
        if (value.transcodedVideoFile) {
          displayFilename = `${value.transcodedVideoFile}`;
          originalBasePath = npath.join(projectBasePath, key);
        }
        videoUrl = makeMediaUrl(npath.join(originalBasePath, displayFilename));
      } else {
        throw new Error('There is no default display for the multicam dataset');
      }
      multiCamMedia.cameras[key] = {
        imageData,
        videoUrl,
        type: value.type,
      };
    });
    return multiCamMedia;
  }
  throw new Error('There is no multiCam data associated with this');
}

function getMultiCamVideoPath(meta: JsonConfig, forceTranscodedVideo?: boolean) {
  if (meta.multiCam && meta.multiCam.defaultDisplay) {
    if (meta.multiCam.cameras[meta.multiCam.defaultDisplay]) {
      const display = meta.multiCam.cameras[meta.multiCam.defaultDisplay];
      if ((display.transcodedVideoFile && display.transcodedMisalign) || forceTranscodedVideo) {
        return display.transcodedVideoFile;
      }
      return display.originalVideoFile;
    }
    throw new Error(`No video exists for the display file of ${meta.multiCam.defaultDisplay}`);
  }
  throw new Error(`${meta.id} does not contain multiCam data`);
}

function getMultiCamImageFiles(meta: JsonConfig) {
  if (meta.multiCam && meta.multiCam.defaultDisplay) {
    if (meta.multiCam.cameras[meta.multiCam.defaultDisplay]) {
      const display = meta.multiCam.cameras[meta.multiCam.defaultDisplay];
      return display.originalImageFiles;
    }
    throw new Error(`No Image list exists for the display file of ${meta.multiCam.defaultDisplay}`);
  }
  throw new Error(`${meta.id} does not contain multiCam data`);
}

export {
  transcodeMultiCam,
  writeMultiCamStereoPipelineArgs,
  getMultiCamVideoPath,
  getMultiCamImageFiles,
  getMultiCamUrls,
  getTranscodedMultiCamType,
};
