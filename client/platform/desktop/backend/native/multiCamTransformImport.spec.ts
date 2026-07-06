/**
 * Wire-through tests for per-camera transform/calibration files in multicam
 * import: they seed the dataset's saved camera calibration
 * (jsonMeta.cameraHomographies et al.) from an ITK .h5 or a DIVE calibration
 * .json. Uses real temp directories (not mock-fs) because h5wasm's node
 * build reads files through its own emscripten filesystem bindings.
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
let transformPath: string;
let badTransformPath: string;
let calibrationJsonPath: string;
let badCalibrationJsonPath: string;

async function writeAffineFixture(filePath: string) {
  // eslint-disable-next-line import/no-unresolved -- exports-map subpath, see src/@types/h5wasm-node.d.ts
  const h5 = (await import('h5wasm/node')).default;
  await h5.ready;
  const file = new h5.File(filePath, 'w');
  try {
    const transformGroup = file.create_group('TransformGroup');
    const group = transformGroup.create_group('0');
    group.create_dataset({ name: 'TransformType', data: 'AffineTransform_double_2_2' });
    group.create_dataset({
      name: 'TransformParameters',
      data: [2, 0, 0, 2, 10, 20],
      dtype: '<f8',
    });
    group.create_dataset({ name: 'TransformFixedParameters', data: [0, 0], dtype: '<f8' });
  } finally {
    file.close();
  }
}

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

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(npath.join(os.tmpdir(), 'multicam-transform-import-'));
  ['eo', 'ir'].forEach((camera) => {
    const dir = npath.join(tmpDir, camera);
    fs.mkdirSync(dir);
    ['frame0.png', 'frame1.png'].forEach((name) => {
      fs.writeFileSync(npath.join(dir, name), '');
    });
  });
  transformPath = npath.join(tmpDir, 'eo_to_ir.h5');
  await writeAffineFixture(transformPath);
  badTransformPath = npath.join(tmpDir, 'not-a-transform.h5');
  fs.writeFileSync(badTransformPath, 'not hdf5 content');
  calibrationJsonPath = npath.join(tmpDir, 'calibration.json');
  fs.writeJsonSync(calibrationJsonPath, {
    type: 'dive-camera-calibration',
    version: 1,
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
  it('seeds the saved calibration from an .h5 as reference -> camera plus its inverse', async () => {
    const output = await beginMultiCamImport({
      datasetName: 'transform_test',
      defaultDisplay: 'eo',
      cameraOrder: ['eo', 'ir'],
      sourceList: sourceListWith(transformPath),
      type: 'image-sequence',
    });
    // ITK's fixed-to-moving direction: eo (reference, first camera) -> ir.
    // Compare after a JSON round trip, which is also how the seed persists
    // (meta.json) and which normalizes the inversion's -0 entries.
    expect(JSON.parse(JSON.stringify(output.jsonMeta.cameraHomographies))).toEqual({
      'eo::ir': {
        AtoB: [
          [2, 0, 10],
          [0, 2, 20],
          [0, 0, 1],
        ],
        BtoA: [
          [0.5, 0, -5],
          [0, 0.5, -10],
          [0, 0, 1],
        ],
      },
    });
    expect(output.jsonMeta.cameraCorrespondences).toEqual({});
  });

  it('seeds the saved calibration (points and all) from a DIVE calibration .json', async () => {
    const output = await beginMultiCamImport({
      datasetName: 'calibration_json_test',
      defaultDisplay: 'eo',
      cameraOrder: ['eo', 'ir'],
      sourceList: sourceListWith(calibrationJsonPath),
      type: 'image-sequence',
    });
    expect(output.jsonMeta.cameraHomographies?.['eo::ir'].AtoB).toEqual(
      [[1, 0, 5], [0, 1, -3], [0, 0, 1]],
    );
    expect(output.jsonMeta.cameraCorrespondences?.['eo::ir']).toHaveLength(2);
    expect(output.jsonMeta.cameraTransformTypes?.['eo::ir']).toBe('translation');
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

  it('fails the import with a camera-scoped error for an invalid .h5', async () => {
    await expect(beginMultiCamImport({
      datasetName: 'bad_transform',
      defaultDisplay: 'eo',
      sourceList: sourceListWith(badTransformPath),
      type: 'image-sequence',
    })).rejects.toThrow(/Camera "ir": invalid transform file/);
  });

  it('fails the import for a .json without a pairs list', async () => {
    await expect(beginMultiCamImport({
      datasetName: 'bad_calibration_json',
      defaultDisplay: 'eo',
      sourceList: sourceListWith(badCalibrationJsonPath),
      type: 'image-sequence',
    })).rejects.toThrow(/Camera "ir": invalid transform file: not a DIVE calibration file/);
  });

  it('fails the import when the transform file does not exist', async () => {
    await expect(beginMultiCamImport({
      datasetName: 'missing_transform',
      defaultDisplay: 'eo',
      sourceList: sourceListWith(npath.join(tmpDir, 'does-not-exist.h5')),
      type: 'image-sequence',
    })).rejects.toThrow(/Camera "ir": invalid transform file/);
  });

  it('rejects an .h5 attached to the first (reference) camera', async () => {
    await expect(beginMultiCamImport({
      datasetName: 'reference_transform',
      defaultDisplay: 'eo',
      sourceList: {
        eo: {
          sourcePath: npath.join(tmpDir, 'eo'),
          trackFile: '',
          transformFile: transformPath,
        },
        ir: { sourcePath: npath.join(tmpDir, 'ir'), trackFile: '' },
      },
      type: 'image-sequence',
    })).rejects.toThrow(/Camera "eo".*reference/);
  });
});
