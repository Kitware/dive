/**
 * Stitched stereo media is imported in place: both cameras point at the same
 * side-by-side frames and the viewer shows each camera its own half. VIAME
 * reads whole files, so anything handed to it is cut to the camera's half
 * first -- whole media for jobs (cached in the camera's project directory),
 * single frames for the interactive service.
 */
import npath from 'path';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs-extra';
import mime from 'mime-types';
import { cloneDeep } from 'lodash';
import {
  StitchedSide, parseStitchedPath, stitchedCropFilter,
} from 'vue-media-annotator/stitchedStereo';
import { Camera, JsonConfig, Settings } from 'platform/desktop/constants';
import { getBinaryPath, spawnResult } from './utils';

const ffmpegPath = getBinaryPath('ffmpeg-ffprobe-static/ffmpeg');

export const StitchedSplitFolderName = 'stitched_split';
const FrameCacheFolderName = 'dive-stitched-frames';
const FrameCacheLimit = 64;

type MediaFields = Pick<Camera,
  'originalBasePath' | 'originalImageFiles' | 'originalVideoFile'
  | 'transcodedImageFiles' | 'transcodedVideoFile' | 'transcodedMisalign'
  | 'imageListPath' | 'stitchedSide'> & { type: string };

export interface SplitOptions {
  /** Read the transcoded video where one exists (mirrors the job's own choice). */
  forceTranscoded?: boolean;
  onProgress?: (message: string) => void;
}

async function isFresh(source: string, dest: string): Promise<boolean> {
  try {
    const [src, dst] = await Promise.all([fs.stat(source), fs.stat(dest)]);
    return dst.size > 0 && dst.mtimeMs >= src.mtimeMs;
  } catch {
    return false;
  }
}

async function runFfmpeg(args: string[], dest: string) {
  // Written under a temporary name so an interrupted run never leaves a
  // half-written file that the freshness check would accept.
  const partial = npath.join(npath.dirname(dest), `.partial-${npath.basename(dest)}`);
  const result = await spawnResult(ffmpegPath, [...args, '-y', partial]);
  if (result.exitCode !== 0 || !await fs.pathExists(partial)) {
    await fs.remove(partial);
    throw new Error(`Could not split stitched media into ${dest}: ${result.error || 'no output'}`);
  }
  await fs.move(partial, dest, { overwrite: true });
}

export function imageSplitArgs(source: string, side: StitchedSide, seconds?: number): string[] {
  return [
    ...(seconds !== undefined ? ['-ss', seconds.toFixed(6)] : []),
    '-i', source,
    '-vf', stitchedCropFilter(side),
    '-frames:v', '1',
    '-update', '1',
    '-q:v', '1',
  ];
}

export function videoSplitArgs(source: string, side: StitchedSide): string[] {
  return [
    '-i', source,
    // yuv420p needs even dimensions; padding keeps pixel coordinates unchanged.
    '-vf', `${stitchedCropFilter(side)},pad=ceil(iw/2)*2:ceil(ih/2)*2`,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '14',
    '-pix_fmt', 'yuv420p',
    // One output frame per input frame, so frame numbers match the viewer's.
    '-fps_mode', 'passthrough',
  ];
}

/** Output names for split images: basenames, index-prefixed if any collide. */
export function splitImageNames(sources: string[]): string[] {
  const names = sources.map((source) => npath.basename(source));
  if (new Set(names).size === names.length) {
    return names;
  }
  const width = String(names.length).length;
  return names.map((name, index) => `${String(index).padStart(width, '0')}_${name}`);
}

async function splitImages(
  sources: string[],
  side: StitchedSide,
  outDir: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const names = splitImageNames(sources);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < sources.length) {
      const index = next;
      next += 1;
      const dest = npath.join(outDir, names[index]);
      // eslint-disable-next-line no-await-in-loop
      if (!await isFresh(sources[index], dest)) {
        // eslint-disable-next-line no-await-in-loop
        await runFfmpeg(imageSplitArgs(sources[index], side), dest);
      }
      done += 1;
      onProgress?.(done, sources.length);
    }
  };
  const workers = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
  await Promise.all(Array.from({ length: workers }, worker));
  return names;
}

/**
 * Cut one stitched camera's media to its half under `cameraProjectDir` and
 * return media fields that point at the result. Cameras that are not stitched
 * come back unchanged.
 */
export async function splitStitchedCamera<T extends MediaFields>(
  camera: T,
  cameraProjectDir: string,
  label: string,
  options: SplitOptions = {},
): Promise<T> {
  const side = camera.stitchedSide;
  if (!side) {
    return camera;
  }
  const outDir = npath.join(cameraProjectDir, StitchedSplitFolderName);
  await fs.ensureDir(outDir);
  const split: T = {
    ...camera,
    originalBasePath: outDir,
    transcodedImageFiles: [],
    transcodedVideoFile: '',
    transcodedMisalign: false,
    imageListPath: undefined,
    stitchedSide: undefined,
  };
  if (camera.type === 'video') {
    const useTranscoded = !!camera.transcodedVideoFile
      && (options.forceTranscoded || camera.transcodedMisalign);
    const source = useTranscoded
      ? npath.join(cameraProjectDir, camera.transcodedVideoFile)
      : npath.join(camera.originalBasePath, camera.originalVideoFile);
    const name = `${npath.parse(source).name}.mp4`;
    const dest = npath.join(outDir, name);
    if (!await isFresh(source, dest)) {
      options.onProgress?.(`Splitting stitched video for ${label} (first run only)...`);
      await runFfmpeg(videoSplitArgs(source, side), dest);
    }
    split.originalVideoFile = name;
    return split;
  }
  const sources = camera.originalImageFiles.map((image) => (
    npath.isAbsolute(image) ? image : npath.join(camera.originalBasePath, image)
  ));
  split.originalImageFiles = await splitImages(sources, side, outDir, (done, total) => {
    if (done === total || done % 25 === 0) {
      options.onProgress?.(`Splitting stitched images for ${label}: ${done}/${total}`);
    }
  });
  return split;
}

export function hasStitchedMedia(meta: JsonConfig): boolean {
  return !!meta.stitchedSide
    || Object.values(meta.multiCam?.cameras ?? {}).some((camera) => camera.stitchedSide);
}

/**
 * The view of a dataset a VIAME job should read: identical to `meta` unless
 * it holds stitched stereo media, in which case every stitched camera reads
 * its split half instead. The returned config is for building job inputs only
 * and must not be saved back.
 */
export async function withSplitStitchedMedia(
  settings: Settings,
  meta: JsonConfig,
  projectDir: string,
  options: SplitOptions = {},
): Promise<JsonConfig> {
  if (!hasStitchedMedia(meta)) {
    return meta;
  }
  if (!meta.multiCam) {
    return splitStitchedCamera(meta, projectDir, meta.name, options);
  }
  const split = cloneDeep(meta);
  const cameras = Object.entries(meta.multiCam.cameras);
  for (let i = 0; i < cameras.length; i += 1) {
    const [name, camera] = cameras[i];
    // eslint-disable-next-line no-await-in-loop
    split.multiCam!.cameras[name] = await splitStitchedCamera(
      camera,
      npath.join(projectDir, name),
      name,
      options,
    );
  }
  return split;
}

async function pruneFrameCache(dir: string) {
  const names = await fs.readdir(dir);
  if (names.length <= FrameCacheLimit) {
    return;
  }
  const stats = await Promise.all(names.map(async (name) => {
    const path = npath.join(dir, name);
    return { path, mtimeMs: (await fs.stat(path)).mtimeMs };
  }));
  stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
  await Promise.all(
    stats.slice(0, stats.length - FrameCacheLimit).map((entry) => fs.remove(entry.path)),
  );
}

/**
 * Rewrite an interactive-service request whose media paths are tagged as
 * stitched halves (see tagStitchedPath): each tagged `*image_path` is replaced
 * by a still of just that half. Video frames are extracted at the request's
 * `frame_time`, which is then dropped because the stills need no seeking.
 */
export async function resolveStitchedRequestPaths(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tagged = Object.entries(payload).filter(([key, value]) => (
    key.endsWith('image_path') && typeof value === 'string' && parseStitchedPath(value).side
  )) as [string, string][];
  if (!tagged.length) {
    return payload;
  }
  const dir = npath.join(os.tmpdir(), FrameCacheFolderName);
  await fs.ensureDir(dir);
  const frameTime = typeof payload.frame_time === 'number' ? payload.frame_time : undefined;
  const resolved: Record<string, unknown> = { ...payload };
  await Promise.all(tagged.map(async ([key, value]) => {
    const { path, side } = parseStitchedPath(value);
    const stat = await fs.stat(path);
    const digest = crypto.createHash('sha1')
      .update([path, stat.mtimeMs, stat.size, side, frameTime ?? ''].join('|'))
      .digest('hex');
    const dest = npath.join(dir, `${digest}.png`);
    if (!await fs.pathExists(dest)) {
      const isVideo = String(mime.lookup(path) || '').startsWith('video/');
      await runFfmpeg(
        imageSplitArgs(path, side as StitchedSide, isVideo ? frameTime : undefined),
        dest,
      );
    }
    resolved[key] = dest;
  }));
  delete resolved.frame_time;
  pruneFrameCache(dir).catch(() => undefined);
  return resolved;
}
