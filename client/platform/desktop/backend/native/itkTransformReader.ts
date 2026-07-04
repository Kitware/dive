/**
 * Reader for ITK transform files serialized to HDF5 (`.h5`), as produced by
 * VIAME's `itk_point_set_to_transform` tool from a keypointgui `points.txt`.
 *
 * ## File layout
 *
 * ITK's HDF5 transform IO writes one group per transform:
 *
 *     /TransformGroup/<index>/TransformType            (string dataset)
 *     /TransformGroup/<index>/TransformParameters      (float64 dataset)
 *     /TransformGroup/<index>/TransformFixedParameters (float64 dataset)
 *
 * Older ITK releases wrote the parameter dataset names with a historical
 * misspelling (`TranformParameters` / `TranformFixedParameters`); modern ITK
 * reads both, and so does this reader.
 *
 * Only 2-D affine-family transforms are supported (`AffineTransform`,
 * `MatrixOffsetTransformBase`, `Euler2DTransform` / `Rigid2DTransform`,
 * `Similarity2DTransform`, `TranslationTransform`). 3-D, displacement-field /
 * deformable, and multi-component composite transforms are rejected with a
 * descriptive error. A `CompositeTransform` wrapper holding exactly one
 * supported component is unwrapped.
 *
 * ## Physical space vs. pixel space
 *
 * ITK transforms operate on points in physical space. The keypointgui /
 * `itk_point_set_to_transform` flow feeds raw pixel coordinates from
 * `points.txt` directly into `itk::PointSet` (identity spacing, zero origin),
 * so for files produced by that flow physical coordinates ARE pixel
 * coordinates and the reduced matrix below applies to pixels directly. If a
 * file was produced against images with non-identity spacing/origin, that
 * metadata is not represented here.
 *
 * ## Direction convention
 *
 * The reduced matrix is ITK's forward `TransformPoint` direction: it maps
 * FIXED-space points to MOVING-space points ('fixed-to-moving').
 *
 * Evidence (VIAME `plugins/itk/PointSetToTransform.cxx`): `points.txt` rows
 * are read as `ir_x ir_y rgb_x rgb_y`; the RGB/EO points are registered as
 * the FIXED landmarks and the IR points as the MOVING landmarks, both for
 * `itk::LandmarkBasedTransformInitializer` and via
 * `metric->SetMovingTransform(...)`. So for a transform authored from
 * keypointgui points, the matrix maps EO/RGB (reference camera) pixel
 * coordinates to IR (extra camera) pixel coordinates.
 *
 * Consumers that need the opposite direction (e.g. warping an extra camera's
 * display into reference-camera space) should invert the 3x3 matrix; the raw
 * matrix is stored un-inverted on purpose. See SEALTK_MIGRATION_PLAN Q3.
 */
import fs from 'fs-extra';

import type h5wasmDefault from 'h5wasm';

type H5WasmModule = typeof h5wasmDefault;
type H5Group = InstanceType<H5WasmModule['Group']>;
type H5File = InstanceType<H5WasmModule['File']>;

export type TransformDirection = 'fixed-to-moving';

export interface ParsedItkTransform {
  /**
   * Row-major 3x3 homogeneous matrix with [0, 0, 1] bottom row.
   * Maps fixed-space (reference camera) points to moving-space points;
   * see the module docstring for the full convention.
   */
  matrix: number[][];
  /** Original ITK TransformType string, e.g. 'AffineTransform_double_2_2'. */
  type: string;
  /** ITK forward TransformPoint direction. */
  direction: TransformDirection;
}

const TRANSFORM_GROUP = 'TransformGroup';
/** Modern and legacy-misspelled dataset names, in lookup order. */
const PARAMS_NAMES = ['TransformParameters', 'TranformParameters'];
const FIXED_PARAMS_NAMES = ['TransformFixedParameters', 'TranformFixedParameters'];

let h5wasmModule: Promise<H5WasmModule> | null = null;

/**
 * Load h5wasm's node build (direct filesystem access) once. The package is
 * ESM-only, so it must come in through a dynamic import (kept as a native
 * `import()` by the electron-vite/rollup CJS build for external deps).
 */
function loadH5Wasm(): Promise<H5WasmModule> {
  if (h5wasmModule === null) {
    // eslint-disable-next-line import/no-unresolved -- exports-map subpath, see src/@types/h5wasm-node.d.ts
    h5wasmModule = import('h5wasm/node').then(async (mod) => {
      await mod.default.ready;
      return mod.default;
    });
  }
  return h5wasmModule;
}

function asString(value: unknown, context: string): string {
  if (typeof value === 'string') {
    return value.replace(/\0+$/, '');
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].replace(/\0+$/, '');
  }
  throw new Error(`${context}: expected a string dataset`);
}

function asNumberArray(value: unknown, context: string): number[] {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const arr = Array.from(value as ArrayLike<unknown>).map(Number);
    if (arr.every((n) => Number.isFinite(n))) {
      return arr;
    }
  }
  if (typeof value === 'number') {
    return [value];
  }
  throw new Error(`${context}: expected a numeric dataset`);
}

function readDatasetValue(group: H5Group, names: string[]): unknown {
  for (let i = 0; i < names.length; i += 1) {
    const entity = group.get(names[i]);
    if (entity && 'value' in entity) {
      return (entity as { value: unknown }).value;
    }
  }
  return undefined;
}

/** Parse `_<in>_<out>` dimensionality suffix from an ITK TransformType string. */
function transformDimensions(transformType: string): number | null {
  const match = transformType.match(/_(\d+)_(\d+)$/);
  if (match) {
    return Math.max(Number(match[1]), Number(match[2]));
  }
  // Older files may omit the dimension suffix (e.g. 'Euler2DTransform_double').
  if (/3D/.test(transformType)) return 3;
  if (/2D/.test(transformType)) return 2;
  return null;
}

interface AffineDecomposition {
  matrix2x2: number[]; // [m00, m01, m10, m11]
  translation: [number, number];
}

function decomposeParameters(
  transformType: string,
  params: number[],
): AffineDecomposition {
  const baseName = transformType.split('_')[0];
  switch (baseName) {
    case 'AffineTransform':
    case 'MatrixOffsetTransformBase':
      if (params.length !== 6) {
        throw new Error(`${baseName} expects 6 parameters, got ${params.length}`);
      }
      return {
        matrix2x2: [params[0], params[1], params[2], params[3]],
        translation: [params[4], params[5]],
      };
    case 'Similarity2DTransform': {
      if (params.length !== 4) {
        throw new Error(`${baseName} expects 4 parameters, got ${params.length}`);
      }
      const [scale, angle, tx, ty] = params;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return {
        matrix2x2: [scale * cos, -scale * sin, scale * sin, scale * cos],
        translation: [tx, ty],
      };
    }
    case 'Euler2DTransform':
    case 'Rigid2DTransform': {
      if (params.length !== 3) {
        throw new Error(`${baseName} expects 3 parameters, got ${params.length}`);
      }
      const [angle, tx, ty] = params;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return {
        matrix2x2: [cos, -sin, sin, cos],
        translation: [tx, ty],
      };
    }
    case 'TranslationTransform':
      if (params.length !== 2) {
        throw new Error(`${baseName} expects 2 parameters, got ${params.length}`);
      }
      return {
        matrix2x2: [1, 0, 0, 1],
        translation: [params[0], params[1]],
      };
    default:
      throw new Error(
        `unsupported transform type "${transformType}": only 2-D affine-family transforms `
        + '(AffineTransform, MatrixOffsetTransformBase, Euler2D/Rigid2D, Similarity2D, '
        + 'Translation) are supported',
      );
  }
}

/**
 * Reduce ITK MatrixOffsetTransformBase semantics to a plain 3x3 matrix.
 * ITK applies `y = M (x - C) + C + t` where C is the center of rotation
 * (TransformFixedParameters), so the homogeneous offset is `t + C - M C`.
 */
function composeMatrix(
  { matrix2x2, translation }: AffineDecomposition,
  center: [number, number],
): number[][] {
  const [m00, m01, m10, m11] = matrix2x2;
  const [cx, cy] = center;
  const offsetX = translation[0] + cx - (m00 * cx + m01 * cy);
  const offsetY = translation[1] + cy - (m10 * cx + m11 * cy);
  return [
    [m00, m01, offsetX],
    [m10, m11, offsetY],
    [0, 0, 1],
  ];
}

function parseTransformGroup(group: H5Group, transformType: string): ParsedItkTransform {
  const dimensions = transformDimensions(transformType);
  if (dimensions !== null && dimensions !== 2) {
    throw new Error(
      `unsupported transform type "${transformType}": only 2-D transforms are supported`,
    );
  }
  if (/DisplacementField|BSpline|VelocityField/.test(transformType)) {
    throw new Error(
      `unsupported transform type "${transformType}": deformable transforms are not supported`,
    );
  }
  const paramsValue = readDatasetValue(group, PARAMS_NAMES);
  if (paramsValue === undefined) {
    throw new Error(`transform "${transformType}" is missing TransformParameters`);
  }
  const params = asNumberArray(paramsValue, 'TransformParameters');
  const decomposition = decomposeParameters(transformType, params);

  let center: [number, number] = [0, 0];
  const fixedValue = readDatasetValue(group, FIXED_PARAMS_NAMES);
  if (fixedValue !== undefined) {
    const fixed = asNumberArray(fixedValue, 'TransformFixedParameters');
    if (fixed.length >= 2) {
      center = [fixed[0], fixed[1]];
    } else if (fixed.length !== 0) {
      throw new Error(
        `transform "${transformType}" has unexpected TransformFixedParameters length ${fixed.length}`,
      );
    }
  }

  return {
    matrix: composeMatrix(decomposition, center),
    type: transformType,
    direction: 'fixed-to-moving',
  };
}

function readTransformType(group: H5Group, groupName: string): string {
  const typeValue = readDatasetValue(group, ['TransformType']);
  if (typeValue === undefined) {
    throw new Error(`group "${groupName}" is missing a TransformType dataset`);
  }
  return asString(typeValue, `${groupName}/TransformType`);
}

function getChildGroup(parent: H5Group, name: string): H5Group {
  const entity = parent.get(name);
  if (!entity || !('keys' in entity)) {
    throw new Error(`"${name}" is not a group`);
  }
  return entity as H5Group;
}

/**
 * Read a single 2-D affine-family transform from an ITK HDF5 `.h5` file and
 * reduce it to a row-major 3x3 matrix. Throws descriptive errors for missing,
 * malformed, 3-D, deformable, or multi-component files.
 */
/** HDF5 superblock signature: \x89HDF\r\n\x1a\n */
const HDF5_MAGIC = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

async function assertHdf5Signature(filePath: string) {
  let header: Buffer;
  try {
    const fd = await fs.open(filePath, 'r');
    try {
      header = Buffer.alloc(HDF5_MAGIC.length);
      await fs.read(fd, header, 0, HDF5_MAGIC.length, 0);
    } finally {
      await fs.close(fd);
    }
  } catch (err) {
    throw new Error(`could not open "${filePath}": ${err}`);
  }
  // h5wasm does not raise a catchable error for non-HDF5 input, so check the
  // superblock signature up front to produce a clear failure.
  if (!HDF5_MAGIC.every((byte, i) => header[i] === byte)) {
    throw new Error(`could not open "${filePath}" as an HDF5 file (bad signature)`);
  }
}

export async function readItkTransform(filePath: string): Promise<ParsedItkTransform> {
  await assertHdf5Signature(filePath);
  const h5 = await loadH5Wasm();
  let file: H5File;
  try {
    file = new h5.File(filePath, 'r');
  } catch (err) {
    throw new Error(`could not open "${filePath}" as an HDF5 file: ${err}`);
  }
  try {
    if (!file.keys().includes(TRANSFORM_GROUP)) {
      throw new Error(
        `"${filePath}" is not an ITK transform file (missing /${TRANSFORM_GROUP})`,
      );
    }
    const transformGroup = getChildGroup(file, TRANSFORM_GROUP);
    const indices = transformGroup.keys()
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    if (indices.length === 0) {
      throw new Error(`"${filePath}" contains no transforms under /${TRANSFORM_GROUP}`);
    }

    let entries = indices.map((index) => {
      const group = getChildGroup(transformGroup, index);
      return { group, transformType: readTransformType(group, `${TRANSFORM_GROUP}/${index}`) };
    });

    // A CompositeTransform writes itself at index 0 and its components after it.
    if (entries[0].transformType.startsWith('CompositeTransform')) {
      entries = entries.slice(1);
      if (entries.length === 0) {
        throw new Error(`"${filePath}" contains an empty CompositeTransform`);
      }
    }
    if (entries.length > 1) {
      throw new Error(
        `"${filePath}" contains ${entries.length} transforms; only single-transform files are supported`,
      );
    }
    return parseTransformGroup(entries[0].group, entries[0].transformType);
  } finally {
    file.close();
  }
}

export default readItkTransform;
