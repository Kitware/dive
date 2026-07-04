/**
 * Wire-through tests for per-camera ITK .h5 transform files in multicam
 * import. Uses real temp directories (not mock-fs) because h5wasm's node
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
});

afterAll(() => {
  fs.removeSync(tmpDir);
});

describe('multiCamImport transform wire-through', () => {
  it('parses a transform file for an extra camera into multiCam meta', async () => {
    const output = await beginMultiCamImport({
      datasetName: 'transform_test',
      defaultDisplay: 'eo',
      cameraOrder: ['eo', 'ir'],
      sourceList: {
        eo: { sourcePath: npath.join(tmpDir, 'eo'), trackFile: '' },
        ir: {
          sourcePath: npath.join(tmpDir, 'ir'),
          trackFile: '',
          transformFile: transformPath,
        },
      },
      type: 'image-sequence',
    });
    const { multiCam } = output.jsonMeta;
    expect(multiCam).toBeTruthy();
    expect(multiCam?.cameras.eo.transform).toBeUndefined();
    expect(multiCam?.cameras.ir.transform).toEqual({
      matrix: [
        [2, 0, 10],
        [0, 2, 20],
        [0, 0, 1],
      ],
      type: 'AffineTransform_double_2_2',
      direction: 'fixed-to-moving',
      source: transformPath,
    });
    // The stored transform must survive JSON round-tripping (meta.json).
    expect(JSON.parse(JSON.stringify(multiCam?.cameras.ir.transform)))
      .toEqual(multiCam?.cameras.ir.transform);
  });

  it('leaves transform unset when no transform file is given', async () => {
    const output = await beginMultiCamImport({
      datasetName: 'no_transform',
      defaultDisplay: 'eo',
      sourceList: {
        eo: { sourcePath: npath.join(tmpDir, 'eo'), trackFile: '' },
        ir: { sourcePath: npath.join(tmpDir, 'ir'), trackFile: '' },
      },
      type: 'image-sequence',
    });
    expect(output.jsonMeta.multiCam?.cameras.ir.transform).toBeUndefined();
  });

  it('fails the import with a camera-scoped error for an invalid transform file', async () => {
    await expect(beginMultiCamImport({
      datasetName: 'bad_transform',
      defaultDisplay: 'eo',
      sourceList: {
        eo: { sourcePath: npath.join(tmpDir, 'eo'), trackFile: '' },
        ir: {
          sourcePath: npath.join(tmpDir, 'ir'),
          trackFile: '',
          transformFile: badTransformPath,
        },
      },
      type: 'image-sequence',
    })).rejects.toThrow(/Camera "ir": invalid ITK transform file/);
  });

  it('fails the import when the transform file does not exist', async () => {
    await expect(beginMultiCamImport({
      datasetName: 'missing_transform',
      defaultDisplay: 'eo',
      sourceList: {
        eo: { sourcePath: npath.join(tmpDir, 'eo'), trackFile: '' },
        ir: {
          sourcePath: npath.join(tmpDir, 'ir'),
          trackFile: '',
          transformFile: npath.join(tmpDir, 'does-not-exist.h5'),
        },
      },
      type: 'image-sequence',
    })).rejects.toThrow(/Camera "ir": invalid ITK transform file/);
  });
});
