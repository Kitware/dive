import { describe, expect, it } from 'vitest';

import type { Camera } from 'platform/desktop/constants';
import { resolveMultiCamImagePath } from './multiCamUtils';

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
