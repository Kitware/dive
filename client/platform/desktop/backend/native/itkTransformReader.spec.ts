import os from 'os';
import npath from 'path';
import fs from 'fs-extra';

import { readItkTransform } from './itkTransformReader';

interface FixtureTransform {
  type: string;
  params?: number[];
  fixed?: number[];
  /** Override dataset name, e.g. legacy misspelled 'TranformParameters'. */
  paramsName?: string;
  fixedName?: string;
}

let tmpDir: string;
let fixtureCount = 0;

async function loadH5() {
  // eslint-disable-next-line import/no-unresolved -- exports-map subpath, see src/@types/h5wasm-node.d.ts
  const h5 = (await import('h5wasm/node')).default;
  await h5.ready;
  return h5;
}

async function writeTransformFile(transforms: FixtureTransform[]): Promise<string> {
  const h5 = await loadH5();
  fixtureCount += 1;
  const filePath = npath.join(tmpDir, `fixture-${fixtureCount}.h5`);
  const file = new h5.File(filePath, 'w');
  try {
    const transformGroup = file.create_group('TransformGroup');
    transforms.forEach((transform, index) => {
      const group = transformGroup.create_group(String(index));
      group.create_dataset({ name: 'TransformType', data: transform.type });
      if (transform.params !== undefined) {
        group.create_dataset({
          name: transform.paramsName || 'TransformParameters',
          data: transform.params,
          dtype: '<f8',
        });
      }
      if (transform.fixed !== undefined) {
        group.create_dataset({
          name: transform.fixedName || 'TransformFixedParameters',
          data: transform.fixed,
          dtype: '<f8',
        });
      }
    });
  } finally {
    file.close();
  }
  return filePath;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(npath.join(os.tmpdir(), 'itk-transform-reader-'));
});

afterAll(() => {
  fs.removeSync(tmpDir);
});

describe('itkTransformReader', () => {
  it('reduces a 2D affine transform with a rotation center to a 3x3 matrix', async () => {
    const path = await writeTransformFile([{
      type: 'AffineTransform_double_2_2',
      params: [1.1, 0.2, -0.3, 0.9, 5, -7],
      fixed: [100, 50],
    }]);
    const result = await readItkTransform(path);
    expect(result.type).toBe('AffineTransform_double_2_2');
    expect(result.direction).toBe('fixed-to-moving');
    // offset = t + C - M*C
    expect(result.matrix[0][0]).toBeCloseTo(1.1);
    expect(result.matrix[0][1]).toBeCloseTo(0.2);
    expect(result.matrix[0][2]).toBeCloseTo(5 + 100 - (1.1 * 100 + 0.2 * 50));
    expect(result.matrix[1][0]).toBeCloseTo(-0.3);
    expect(result.matrix[1][1]).toBeCloseTo(0.9);
    expect(result.matrix[1][2]).toBeCloseTo(-7 + 50 - (-0.3 * 100 + 0.9 * 50));
    expect(result.matrix[2]).toEqual([0, 0, 1]);
  });

  it('handles MatrixOffsetTransformBase the same as affine', async () => {
    const path = await writeTransformFile([{
      type: 'MatrixOffsetTransformBase_double_2_2',
      params: [2, 0, 0, 2, 1, 1],
      fixed: [0, 0],
    }]);
    const result = await readItkTransform(path);
    expect(result.matrix).toEqual([
      [2, 0, 1],
      [0, 2, 1],
      [0, 0, 1],
    ]);
  });

  it('expands a Similarity2D transform (scale * rotation)', async () => {
    const path = await writeTransformFile([{
      type: 'Similarity2DTransform_double_2_2',
      params: [2, Math.PI / 2, 3, 4],
      fixed: [0, 0],
    }]);
    const { matrix } = await readItkTransform(path);
    expect(matrix[0][0]).toBeCloseTo(0);
    expect(matrix[0][1]).toBeCloseTo(-2);
    expect(matrix[0][2]).toBeCloseTo(3);
    expect(matrix[1][0]).toBeCloseTo(2);
    expect(matrix[1][1]).toBeCloseTo(0);
    expect(matrix[1][2]).toBeCloseTo(4);
  });

  it('reads a rigid Euler2D transform without a dimension suffix and with legacy misspelled dataset names', async () => {
    const path = await writeTransformFile([{
      type: 'Euler2DTransform_double',
      params: [0, 10, 20],
      fixed: [5, 5],
      paramsName: 'TranformParameters',
      fixedName: 'TranformFixedParameters',
    }]);
    const { matrix } = await readItkTransform(path);
    expect(matrix).toEqual([
      [1, -0, 10],
      [0, 1, 20],
      [0, 0, 1],
    ]);
  });

  it('reads a translation transform with no fixed parameters dataset', async () => {
    const path = await writeTransformFile([{
      type: 'TranslationTransform_double_2_2',
      params: [7, 8],
    }]);
    const { matrix } = await readItkTransform(path);
    expect(matrix).toEqual([
      [1, 0, 7],
      [0, 1, 8],
      [0, 0, 1],
    ]);
  });

  it('unwraps a CompositeTransform holding a single affine component', async () => {
    const path = await writeTransformFile([
      { type: 'CompositeTransform_double_2_2' },
      {
        type: 'AffineTransform_double_2_2',
        params: [1, 0, 0, 1, 4, 5],
        fixed: [0, 0],
      },
    ]);
    const result = await readItkTransform(path);
    expect(result.type).toBe('AffineTransform_double_2_2');
    expect(result.matrix[0][2]).toBe(4);
    expect(result.matrix[1][2]).toBe(5);
  });

  it('rejects a CompositeTransform with multiple components', async () => {
    const path = await writeTransformFile([
      { type: 'CompositeTransform_double_2_2' },
      { type: 'AffineTransform_double_2_2', params: [1, 0, 0, 1, 0, 0], fixed: [0, 0] },
      { type: 'AffineTransform_double_2_2', params: [1, 0, 0, 1, 0, 0], fixed: [0, 0] },
    ]);
    await expect(readItkTransform(path)).rejects.toThrow(/2 transforms/);
  });

  it('rejects 3D transforms', async () => {
    const path = await writeTransformFile([{
      type: 'AffineTransform_double_3_3',
      params: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      fixed: [0, 0, 0],
    }]);
    await expect(readItkTransform(path)).rejects.toThrow(/only 2-D/);
  });

  it('rejects displacement field transforms', async () => {
    const path = await writeTransformFile([{
      type: 'DisplacementFieldTransform_double_2_2',
      params: [0, 0, 0, 0],
      fixed: [0, 0],
    }]);
    await expect(readItkTransform(path)).rejects.toThrow(/deformable/);
  });

  it('rejects unsupported affine-family variants with a clear error', async () => {
    const path = await writeTransformFile([{
      type: 'CenteredRigid2DTransform_double_2_2',
      params: [0, 5, 5, 1, 2],
      fixed: [5, 5],
    }]);
    await expect(readItkTransform(path)).rejects.toThrow(/unsupported transform type/);
  });

  it('rejects a transform with the wrong parameter count', async () => {
    const path = await writeTransformFile([{
      type: 'AffineTransform_double_2_2',
      params: [1, 0, 0, 1],
      fixed: [0, 0],
    }]);
    await expect(readItkTransform(path)).rejects.toThrow(/expects 6 parameters/);
  });

  it('rejects an HDF5 file without a TransformGroup', async () => {
    const h5 = await loadH5();
    const path = npath.join(tmpDir, 'no-transform-group.h5');
    const file = new h5.File(path, 'w');
    file.create_group('SomethingElse');
    file.close();
    await expect(readItkTransform(path)).rejects.toThrow(/missing \/TransformGroup/);
  });

  it('rejects a transform group missing TransformParameters', async () => {
    const path = await writeTransformFile([{
      type: 'AffineTransform_double_2_2',
      fixed: [0, 0],
    }]);
    await expect(readItkTransform(path)).rejects.toThrow(/missing TransformParameters/);
  });

  it('rejects a file that is not HDF5 at all', async () => {
    const path = npath.join(tmpDir, 'not-hdf5.h5');
    fs.writeFileSync(path, 'this is not an hdf5 file');
    await expect(readItkTransform(path)).rejects.toThrow(/could not open/);
  });
});
