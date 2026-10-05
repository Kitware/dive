/// <reference types="vitest/globals" />
import os from 'os';
import npath from 'path';
import fs from 'fs-extra';

import type { JsonConfig, Settings } from 'platform/desktop/constants';
import { tagStitchedPath } from 'vue-media-annotator/stitchedStereo';
import beginMultiCamImport from './multiCamImport';
import { transcodeMultiCam } from './multiCamUtils';
import {
  resolveStitchedRequestPaths,
  splitImageNames,
  StitchedSplitFolderName,
  withSplitStitchedMedia,
} from './stitchedMedia';

const ffmpegCalls: string[][] = [];

vi.mock('./utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('./utils')>(),
  // Stands in for ffmpeg: records the arguments and writes the output file.
  spawnResult: vi.fn(async (_command: string, args: string[]) => {
    ffmpegCalls.push(args);
    fs.writeFileSync(args[args.length - 1], 'split');
    return { output: '', exitCode: 0, error: '' };
  }),
}));

vi.mock('./mediaJobs', () => ({
  checkMedia: vi.fn(() => Promise.resolve({
    websafe: true,
    originalFpsString: '30/1',
    originalFps: 30,
    videoDimensions: { width: 1920, height: 1080 },
  })),
}));

const settings = {} as Settings;
let tmpDir: string;
let stitchedDir: string;
let stitchedVideo: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(npath.join(os.tmpdir(), 'stitched-stereo-'));
  stitchedDir = npath.join(tmpDir, 'pairs');
  fs.mkdirSync(stitchedDir);
  ['frame0.jpg', 'frame1.jpg'].forEach((name) => {
    fs.writeFileSync(npath.join(stitchedDir, name), 'stitched');
  });
  stitchedVideo = npath.join(tmpDir, 'pairs.mp4');
  fs.writeFileSync(stitchedVideo, 'stitched');
});

afterAll(() => {
  fs.removeSync(tmpDir);
});

beforeEach(() => {
  ffmpegCalls.length = 0;
});

function stitchedImport(type: 'image-sequence' | 'video', sourcePath: string) {
  return beginMultiCamImport({
    datasetName: 'pairs',
    defaultDisplay: 'left',
    cameraOrder: ['left', 'right'],
    sourceList: {
      left: { sourcePath, trackFile: '' },
      right: { sourcePath, trackFile: '' },
    },
    type,
    stitched: true,
  });
}

describe('stitched stereo import', () => {
  it('imports one image folder as a stereo pair sharing its media', async () => {
    const { jsonConfig, mediaConvertList } = await stitchedImport('image-sequence', stitchedDir);
    const { cameras } = jsonConfig.multiCam!;
    expect(jsonConfig.subType).toBe('stereo');
    expect(mediaConvertList).toEqual([]);
    (['left', 'right'] as const).forEach((side) => {
      expect(cameras[side].stitchedSide).toBe(side);
      expect(cameras[side].originalBasePath).toBe(stitchedDir);
      expect(cameras[side].originalImageFiles).toEqual(['frame0.jpg', 'frame1.jpg']);
    });
  });

  it('imports one video as a stereo pair sharing its media', async () => {
    const { jsonConfig } = await stitchedImport('video', stitchedVideo);
    const { cameras } = jsonConfig.multiCam!;
    expect(jsonConfig.subType).toBe('stereo');
    expect(cameras.left).toMatchObject({ stitchedSide: 'left', originalVideoFile: 'pairs.mp4' });
    expect(cameras.right).toMatchObject({ stitchedSide: 'right', originalVideoFile: 'pairs.mp4' });
  });

  it('rejects cameras that do not share one source', async () => {
    await expect(beginMultiCamImport({
      defaultDisplay: 'left',
      sourceList: {
        left: { sourcePath: stitchedDir, trackFile: '' },
        right: { sourcePath: tmpDir, trackFile: '' },
      },
      type: 'image-sequence',
      stitched: true,
    })).rejects.toThrow('sharing one source');
  });

  it('transcodes a shared source once per camera', async () => {
    const { jsonConfig } = await stitchedImport('image-sequence', stitchedDir);
    const source = npath.join(stitchedDir, 'frame0.jpg');
    const first = transcodeMultiCam(jsonConfig, source, '/project');
    const second = transcodeMultiCam(jsonConfig, source, '/project');
    expect([first, second]).toEqual(['/project/left/frame0.png', '/project/right/frame0.png']);
    expect(jsonConfig.multiCam!.cameras.left.transcodedImageFiles).toEqual(['frame0.png']);
    expect(jsonConfig.multiCam!.cameras.right.transcodedImageFiles).toEqual(['frame0.png']);
  });
});

describe('withSplitStitchedMedia', () => {
  it('returns datasets without stitched media untouched', async () => {
    const meta = { multiCam: null } as JsonConfig;
    expect(await withSplitStitchedMedia(settings, meta, tmpDir)).toBe(meta);
    expect(ffmpegCalls).toEqual([]);
  });

  it('points each camera of a stereo dataset at its own half, once', async () => {
    const { jsonConfig } = await stitchedImport('image-sequence', stitchedDir);
    const projectDir = npath.join(tmpDir, 'project-images');
    const split = await withSplitStitchedMedia(settings, jsonConfig, projectDir);

    const { right } = split.multiCam!.cameras;
    const rightDir = npath.join(projectDir, 'right', StitchedSplitFolderName);
    expect(right.stitchedSide).toBeUndefined();
    expect(right.originalBasePath).toBe(rightDir);
    expect(right.originalImageFiles).toEqual(['frame0.jpg', 'frame1.jpg']);
    expect(fs.existsSync(npath.join(rightDir, 'frame1.jpg'))).toBe(true);
    expect(ffmpegCalls).toHaveLength(4);
    const rightCall = ffmpegCalls.find((args) => args[args.length - 1].startsWith(rightDir))!;
    expect(rightCall).toContain('crop=trunc(iw/2):ih:iw-trunc(iw/2):0');
    // The stored config still describes the stitched source.
    expect(jsonConfig.multiCam!.cameras.right.originalBasePath).toBe(stitchedDir);

    await withSplitStitchedMedia(settings, jsonConfig, projectDir);
    expect(ffmpegCalls).toHaveLength(4);
  });

  it('splits the video of a single stitched camera dataset', async () => {
    const { jsonConfig } = await stitchedImport('video', stitchedVideo);
    const cameraMeta = {
      ...jsonConfig, ...jsonConfig.multiCam!.cameras.left, multiCam: null,
    } as JsonConfig;
    const projectDir = npath.join(tmpDir, 'project-video', 'left');
    const split = await withSplitStitchedMedia(settings, cameraMeta, projectDir);
    expect(split.originalBasePath).toBe(npath.join(projectDir, StitchedSplitFolderName));
    expect(split.originalVideoFile).toBe('pairs.mp4');
    expect(split.stitchedSide).toBeUndefined();
    expect(ffmpegCalls).toHaveLength(1);
    expect(ffmpegCalls[0].join(' ')).toContain('crop=trunc(iw/2):ih:0:0,pad=');
  });

  it('keeps colliding image names apart', () => {
    expect(splitImageNames(['/a/x.png', '/b/y.png'])).toEqual(['x.png', 'y.png']);
    expect(splitImageNames(['/a/x.png', '/b/x.png'])).toEqual(['0_x.png', '1_x.png']);
  });
});

describe('resolveStitchedRequestPaths', () => {
  it('passes untagged requests through unchanged', async () => {
    const payload = { command: 'predict', image_path: '/data/a.png', frame_time: 1 };
    expect(await resolveStitchedRequestPaths(payload)).toBe(payload);
  });

  it('replaces tagged image paths with stills of each half', async () => {
    const image = npath.join(stitchedDir, 'frame0.jpg');
    const resolved = await resolveStitchedRequestPaths({
      command: 'set_frame',
      left_image_path: tagStitchedPath(image, 'left'),
      right_image_path: tagStitchedPath(image, 'right'),
    });
    expect(resolved.left_image_path).not.toBe(resolved.right_image_path);
    expect(fs.existsSync(resolved.left_image_path as string)).toBe(true);
    expect(ffmpegCalls.map((args) => args.includes('-ss'))).toEqual([false, false]);
  });

  it('extracts the requested video frame and drops the frame time', async () => {
    const resolved = await resolveStitchedRequestPaths({
      command: 'predict',
      image_path: tagStitchedPath(stitchedVideo, 'right'),
      frame_time: 2.5,
    });
    expect(resolved.frame_time).toBeUndefined();
    expect(resolved.image_path).toMatch(/\.png$/);
    expect(ffmpegCalls[0].slice(0, 4)).toEqual(['-ss', '2.500000', '-i', stitchedVideo]);
  });
});
