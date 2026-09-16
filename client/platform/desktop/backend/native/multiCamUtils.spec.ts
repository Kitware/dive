import { describe, expect, it } from 'vitest';

import type { Camera, JsonConfig } from 'platform/desktop/constants';
import { resolveMultiCamImagePath, videoSubsetCameras } from './multiCamUtils';

describe('resolveMultiCamImagePath', () => {
  it('maps transcoded PNG basenames to the project camera directory', () => {
    const camera: Camera = {
      type: 'image-sequence',
      originalBasePath: '/media/data/IR',
      originalImageFiles: ['kamera_calibration_fl02_C_20240407_131611.306144_ir.tif'],
      originalVideoFile: '',
      transcodedImageFiles: ['kamera_calibration_fl02_C_20240407_131611.306144_ir.png'],
      transcodedVideoFile: '',
    };

    expect(resolveMultiCamImagePath(
      'IR',
      camera,
      '/projects/multicam-test',
      'kamera_calibration_fl02_C_20240407_131611.306144_ir.png',
    )).toBe(
      '/projects/multicam-test/IR/kamera_calibration_fl02_C_20240407_131611.306144_ir.png',
    );
  });

  it('keeps original paths for cameras without transcoded copies', () => {
    const camera: Camera = {
      type: 'image-sequence',
      originalBasePath: '/media/data/EO',
      originalImageFiles: ['kamera_calibration_fl02_C_20240407_131611.306144_rgb.jpg'],
      originalVideoFile: '',
      transcodedImageFiles: [],
      transcodedVideoFile: '',
    };

    expect(resolveMultiCamImagePath(
      'EO',
      camera,
      '/projects/multicam-test',
      'kamera_calibration_fl02_C_20240407_131611.306144_rgb.jpg',
    )).toBe(
      '/media/data/EO/kamera_calibration_fl02_C_20240407_131611.306144_rgb.jpg',
    );
  });
});

describe('videoSubsetCameras', () => {
  const meta = {
    multiCam: {
      cameras: {
        G336: { type: 'video' },
        G337: { type: 'video' },
        IR: { type: 'image-sequence' },
      },
    },
  } as unknown as JsonConfig;

  it('names only the video cameras a subset run will extract', () => {
    expect(videoSubsetCameras(meta, { G336: ['frame://0'], IR: ['000.png'] })).toEqual(['G336']);
  });

  it('is empty without a subset, so ordinary runs still bind a video reader', () => {
    expect(videoSubsetCameras(meta, undefined)).toEqual([]);
  });

  it('is empty for an image-sequence-only subset', () => {
    expect(videoSubsetCameras(meta, { IR: ['000.png'] })).toEqual([]);
  });

  it('ignores subset entries for cameras the dataset does not have', () => {
    expect(videoSubsetCameras(meta, { ghost: ['frame://0'] })).toEqual([]);
  });

  it('is empty on a single-camera dataset', () => {
    expect(videoSubsetCameras({} as JsonConfig, { G336: ['frame://0'] })).toEqual([]);
  });
});
