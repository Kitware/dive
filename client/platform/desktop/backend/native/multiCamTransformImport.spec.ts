/**
 * Wire-through tests for per-camera transform/registration files in multicam
 * import: they seed the dataset's saved camera registration
 * (jsonMeta.cameraHomographies et al.) from a DIVE registration .json.
 */
import os from 'os';
import npath from 'path';
import fs from 'fs-extra';

import beginMultiCamImport from './multiCamImport';

vi.mock('./mediaJobs', () => ({
  checkMedia: vi.fn(() => Promise.resolve({
    websafe: true,
    originalFpsString: '30/1',
    originalFps: 30,
    videoDimensions: { width: 1920, height: 1080 },
  })),
}));

let tmpDir: string;
let registrationJsonPath: string;
let badCalibrationJsonPath: string;

function sourceListWith(transformFile?: string) {
  return {
    eo: { sourcePath: npath.join(tmpDir, 'eo'), trackFile: '' },
    ir: {
      sourcePath: npath.join(tmpDir, 'ir'),
      trackFile: '',
      ...(transformFile ? { transformFile } : {}),
    },
  };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(npath.join(os.tmpdir(), 'multicam-transform-import-'));
  ['eo', 'ir'].forEach((camera) => {
    const dir = npath.join(tmpDir, camera);
    fs.mkdirSync(dir);
    ['frame0.png', 'frame1.png'].forEach((name) => {
      fs.writeFileSync(npath.join(dir, name), '');
    });
  });
  registrationJsonPath = npath.join(tmpDir, 'calibration.json');
  fs.writeJsonSync(registrationJsonPath, {
    type: 'dive-camera-calibration',
    version: 1,
    source: { model: 'colmap-2026-07-01', swathe: 'fl07_C' },
    pairs: [{
      left: 'eo',
      right: 'ir',
      points: [[0, 0, 5, -3], [10, 0, 15, -3]],
      leftToRight: [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
      rightToLeft: [[1, 0, -5], [0, 1, 3], [0, 0, 1]],
      transformType: 'translation',
    }],
  });
  badCalibrationJsonPath = npath.join(tmpDir, 'not-a-calibration.json');
  fs.writeJsonSync(badCalibrationJsonPath, { some: 'other json' });
});

afterAll(() => {
  fs.removeSync(tmpDir);
});

describe('multiCamImport transform wire-through', () => {
  it('seeds the saved registration (points and all) from a DIVE registration .json', async () => {
    const output = await beginMultiCamImport({
      datasetName: 'calibration_json_test',
      defaultDisplay: 'eo',
      cameraOrder: ['eo', 'ir'],
      sourceList: sourceListWith(registrationJsonPath),
      type: 'image-sequence',
    });
    expect(output.jsonMeta.cameraHomographies?.['eo::ir'].AtoB).toEqual(
      [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
    );
    expect(output.jsonMeta.cameraCorrespondences?.['eo::ir']).toHaveLength(2);
    expect(output.jsonMeta.cameraTransformTypes?.['eo::ir']).toBe('translation');
    // The producer provenance stamp travels with the seed.
    expect(output.jsonMeta.cameraRegistrationSource).toEqual(
      { model: 'colmap-2026-07-01', swathe: 'fl07_C' },
    );
  });

  it('leaves the calibration unset when no transform file is given', async () => {
    const output = await beginMultiCamImport({
      datasetName: 'no_transform',
      defaultDisplay: 'eo',
      sourceList: sourceListWith(),
      type: 'image-sequence',
    });
    expect(output.jsonMeta.cameraHomographies).toBeUndefined();
    expect(output.jsonMeta.cameraCorrespondences).toBeUndefined();
  });

  it('fails the import for a .json without a pairs list', async () => {
    await expect(beginMultiCamImport({
      datasetName: 'bad_calibration_json',
      defaultDisplay: 'eo',
      sourceList: sourceListWith(badCalibrationJsonPath),
      type: 'image-sequence',
    })).rejects.toThrow(/Camera "ir": invalid transform file: not a DIVE registration file/);
  });

  it('fails the import for a file that is not JSON at all', async () => {
    const notJsonPath = npath.join(tmpDir, 'not-json.json');
    fs.writeFileSync(notJsonPath, 'not json content');
    await expect(beginMultiCamImport({
      datasetName: 'not_json_transform',
      defaultDisplay: 'eo',
      sourceList: sourceListWith(notJsonPath),
      type: 'image-sequence',
    })).rejects.toThrow(/Camera "ir": invalid transform file/);
  });

  it('fails the import when the transform file does not exist', async () => {
    await expect(beginMultiCamImport({
      datasetName: 'missing_transform',
      defaultDisplay: 'eo',
      sourceList: sourceListWith(npath.join(tmpDir, 'does-not-exist.json')),
      type: 'image-sequence',
    })).rejects.toThrow(/Camera "ir": invalid transform file/);
  });
});
