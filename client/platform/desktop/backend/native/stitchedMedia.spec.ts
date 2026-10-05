/// <reference types="vitest/globals" />
import os from 'os';
import npath from 'path';
import fs from 'fs-extra';

import type { JsonConfig, Settings } from 'platform/desktop/constants';
import beginMultiCamImport from './multiCamImport';
import { transcodeMultiCam, writeMultiCamStereoPipelineArgs } from './multiCamUtils';
import { hasStitchedMedia, stitchedReaderSettings } from './stitchedMedia';

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

describe('stitched reader settings', () => {
  it('names the VIAME reader and side for a stitched input', () => {
    expect(stitchedReaderSettings('input2', 'right')).toEqual({
      'input2:video_reader:type': 'stitched_side',
      'input2:video_reader:stitched_side:side': 'right',
    });
    expect(stitchedReaderSettings('input', undefined)).toEqual({});
  });

  it('recognizes stitched datasets and their camera datasets', async () => {
    const { jsonConfig } = await stitchedImport('video', stitchedVideo);
    expect(hasStitchedMedia(jsonConfig)).toBe(true);
    expect(hasStitchedMedia({ multiCam: null, stitchedSide: 'left' } as JsonConfig)).toBe(true);
    expect(hasStitchedMedia({ multiCam: null } as JsonConfig)).toBe(false);
  });

  it.each([
    ['image-sequence', () => stitchedDir],
    ['video', () => stitchedVideo],
  ] as const)('feeds a stereo pipeline the stitched %s itself', async (type, source) => {
    const { jsonConfig } = await stitchedImport(type, source());
    const jobDir = fs.mkdtempSync(npath.join(tmpDir, 'job-'));
    const { argFilePair } = await writeMultiCamStereoPipelineArgs(jobDir, jsonConfig, settings);

    expect(argFilePair).toMatchObject({
      'input:video_reader:type': 'stitched_side',
      'input:video_reader:stitched_side:side': 'left',
      'input1:video_reader:type': 'stitched_side',
      'input1:video_reader:stitched_side:side': 'left',
      'input2:video_reader:type': 'stitched_side',
      'input2:video_reader:stitched_side:side': 'right',
    });
    if (type === 'video') {
      expect(argFilePair['input1:video_filename']).toBe(stitchedVideo);
      expect(argFilePair['input2:video_filename']).toBe(stitchedVideo);
    } else {
      // The list is written through a stream the caller does not wait on.
      await vi.waitFor(() => {
        const frames = fs.readFileSync(argFilePair['input2:video_filename'], 'utf8').trim();
        expect(frames.split('\n')).toEqual([
          npath.join(stitchedDir, 'frame0.jpg'), npath.join(stitchedDir, 'frame1.jpg'),
        ]);
      });
    }
  });
});
