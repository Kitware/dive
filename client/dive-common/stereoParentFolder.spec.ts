// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import { describe, expect, it } from 'vitest';

import { commonPathPrefix } from 'dive-common/components/ImportMultiCamDialog/multicamSubfolderLayout';
import {
  findStereoCalibrationInFileList,
  isStereoCalibrationFileName,
  pickStereoCalibrationFileName,
} from './stereoParentFolder';

describe('isStereoCalibrationFileName', () => {
  it('accepts json/npz with calibration or cal in the name', () => {
    expect(isStereoCalibrationFileName('stereoCalibration.npz')).toBe(true);
    expect(isStereoCalibrationFileName('stereo_cal.json')).toBe(true);
    expect(isStereoCalibrationFileName('notes.txt')).toBe(false);
    expect(isStereoCalibrationFileName('data.json')).toBe(false);
    expect(isStereoCalibrationFileName('calibration.yml')).toBe(false);
  });
});

describe('pickStereoCalibrationFileName', () => {
  it('prefers calibration-like names', () => {
    expect(pickStereoCalibrationFileName([
      'stereo_cal.json',
      'stereoCalibration.npz',
    ])).toBe('stereoCalibration.npz');
  });
});

describe('findStereoCalibrationInFileList', () => {
  const mk = (path: string) => ({ webkitRelativePath: path, name: path.split('/').pop() } as File);

  it('finds calibration files in the parent folder root', () => {
    const match = findStereoCalibrationInFileList([
      mk('stereo/left/video.mp4'),
      mk('stereo/right/video.mp4'),
      mk('stereo/stereoCalibration.npz'),
    ], 'stereo', commonPathPrefix);
    expect(match?.path).toBe('stereoCalibration.npz');
  });
});
