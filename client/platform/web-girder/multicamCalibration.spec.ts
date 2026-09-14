import { describe, expect, it } from 'vitest';

import {
  isAllowedStereoCalibrationFilename,
  stereoCalibrationAllowedExtensionsLabel,
} from './multicamCalibration';

describe('multicamCalibration', () => {
  it('allows json and npz calibration files', () => {
    expect(isAllowedStereoCalibrationFilename('calibration.json')).toBe(true);
    expect(isAllowedStereoCalibrationFilename('stereo.npz')).toBe(true);
  });

  it('rejects unknown extensions', () => {
    expect(isAllowedStereoCalibrationFilename('readme.txt')).toBe(false);
  });

  it('lists allowed extensions for error messages', () => {
    expect(stereoCalibrationAllowedExtensionsLabel()).toContain('.json');
    expect(stereoCalibrationAllowedExtensionsLabel()).toContain('.npz');
  });
});
