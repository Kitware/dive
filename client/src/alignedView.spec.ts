/// <reference types="vitest" />
import {
  IDENTITY3,
  isIdentityMatrix3,
  readTransformMatrix,
  composeThroughPairs,
  resolveToReferenceTransforms,
  cameraPairTransform,
  mapPoint,
} from './alignedView';
import { applyHomography, Matrix3, Point } from './homography';
import type { CameraHomographies } from './CameraCalibrationStore';
import AlignedViewStore from './AlignedViewStore';

/** Simple affine helpers for readable fixtures. */
function translation(tx: number, ty: number): Matrix3 {
  return [[1, 0, tx], [0, 1, ty], [0, 0, 1]];
}
function scale(s: number): Matrix3 {
  return [[s, 0, 0], [0, s, 0], [0, 0, 1]];
}

function expectPointClose(actual: Point, expected: Point) {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
}

describe('isIdentityMatrix3', () => {
  it('accepts the identity and rejects non-identity', () => {
    expect(isIdentityMatrix3(IDENTITY3)).toBe(true);
    expect(isIdentityMatrix3(translation(0, 0))).toBe(true);
    expect(isIdentityMatrix3(translation(1, 0))).toBe(false);
    expect(isIdentityMatrix3(scale(2))).toBe(false);
  });
});

describe('readTransformMatrix', () => {
  it('accepts a valid row-major 3x3', () => {
    const m = readTransformMatrix([[1, 0, 5], [0, 1, -3], [0, 0, 1]]);
    expect(m).toEqual([[1, 0, 5], [0, 1, -3], [0, 0, 1]]);
  });
  it('rejects malformed shapes', () => {
    expect(readTransformMatrix(undefined)).toBeNull();
    expect(readTransformMatrix(null)).toBeNull();
    expect(readTransformMatrix('matrix')).toBeNull();
    expect(readTransformMatrix([[1, 0], [0, 1]])).toBeNull();
    expect(readTransformMatrix([[1, 0, 0], [0, 1, 0]])).toBeNull();
    expect(readTransformMatrix([[1, 0, 0], [0, 1, 0], [0, 0]])).toBeNull();
  });
  it('rejects non-finite values', () => {
    expect(readTransformMatrix([[1, 0, NaN], [0, 1, 0], [0, 0, 1]])).toBeNull();
    expect(readTransformMatrix([[1, 0, Infinity], [0, 1, 0], [0, 0, 1]])).toBeNull();
    expect(readTransformMatrix([[1, 0, '5'], [0, 1, 'abc'], [0, 0, 1]])).toBeNull();
  });
  it('rejects singular matrices', () => {
    expect(readTransformMatrix([[1, 1, 0], [1, 1, 0], [0, 0, 1]])).toBeNull();
    expect(readTransformMatrix([[0, 0, 0], [0, 0, 0], [0, 0, 0]])).toBeNull();
  });
});

describe('composeThroughPairs', () => {
  const irToEo = translation(100, 50);
  const uvToIr = scale(2);
  const homographies: CameraHomographies = {
    // eo::ir stored with AtoB = eo->ir, so BtoA = ir->eo.
    'eo::ir': { AtoB: [[1, 0, -100], [0, 1, -50], [0, 0, 1]], BtoA: irToEo },
    // uv::ir stored with AtoB = uv->ir.
    'uv::ir': { AtoB: uvToIr, BtoA: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 1]] },
  };
  it('returns identity for the reference itself', () => {
    expect(composeThroughPairs('eo', 'eo', homographies)).toEqual(IDENTITY3);
  });
  it('uses a direct pair edge in either direction', () => {
    const m = composeThroughPairs('ir', 'eo', homographies);
    expect(m).not.toBeNull();
    expectPointClose(applyHomography(m as Matrix3, [10, 20]), [110, 70]);
  });
  it('composes multi-hop paths (uv -> ir -> eo)', () => {
    const m = composeThroughPairs('uv', 'eo', homographies);
    expect(m).not.toBeNull();
    // uv (x, y) -> ir (2x, 2y) -> eo (2x + 100, 2y + 50).
    expectPointClose(applyHomography(m as Matrix3, [10, 20]), [120, 90]);
  });
  it('returns null when no path exists', () => {
    expect(composeThroughPairs('flir', 'eo', homographies)).toBeNull();
    expect(composeThroughPairs('ir', 'eo', {})).toBeNull();
  });
});

describe('resolveToReferenceTransforms', () => {
  const cameras = ['eo', 'ir', 'uv'];
  const homographies: CameraHomographies = {
    'eo::ir': { AtoB: translation(-100, 0), BtoA: translation(100, 0) },
    'uv::ir': { AtoB: scale(2), BtoA: scale(0.5) },
  };
  it('resolves every camera through calibration pairs', () => {
    const result = resolveToReferenceTransforms(cameras, 'eo', homographies);
    expect(result).not.toBeNull();
    const transforms = result as Record<string, Matrix3>;
    expect(transforms.eo).toEqual(IDENTITY3);
    expectPointClose(applyHomography(transforms.ir, [5, 5]), [105, 5]);
    expectPointClose(applyHomography(transforms.uv, [5, 5]), [110, 10]);
  });
  it('is all-or-none: any unresolved camera fails the whole set', () => {
    expect(resolveToReferenceTransforms(['eo', 'ir', 'flir'], 'eo', homographies)).toBeNull();
    expect(resolveToReferenceTransforms(cameras, 'eo', {})).toBeNull();
  });
  it('fails when the reference is not among the cameras or the list is empty', () => {
    expect(resolveToReferenceTransforms([], 'eo', homographies)).toBeNull();
    expect(resolveToReferenceTransforms(['ir', 'uv'], 'eo', homographies)).toBeNull();
  });
});

describe('cameraPairTransform', () => {
  it('composes from -> reference -> to', () => {
    const toReference = {
      eo: IDENTITY3,
      ir: translation(100, 0),
      uv: scale(2),
    };
    // ir (x, y) -> ref (x + 100, y) -> uv ((x + 100) / 2, y / 2).
    const m = cameraPairTransform(toReference, 'ir', 'uv');
    expect(m).not.toBeNull();
    expectPointClose(applyHomography(m as Matrix3, [10, 20]), [55, 10]);
  });
  it('returns null for unresolved cameras', () => {
    expect(cameraPairTransform({ eo: IDENTITY3 }, 'eo', 'ir')).toBeNull();
    expect(cameraPairTransform({ eo: IDENTITY3 }, 'ir', 'eo')).toBeNull();
  });
});

describe('mapPoint', () => {
  it('is identity for a null matrix', () => {
    expect(mapPoint(null, [3, 4])).toEqual([3, 4]);
  });
  it('applies the matrix otherwise', () => {
    expectPointClose(mapPoint(translation(1, 2), [3, 4]), [4, 6]);
  });
});

describe('AlignedViewStore', () => {
  function makeResolvedStore() {
    const store = new AlignedViewStore();
    store.setTransforms('eo', {
      eo: IDENTITY3,
      ir: translation(100, 0),
    });
    return store;
  }

  it('is unavailable and inactive by default', () => {
    const store = new AlignedViewStore();
    expect(store.available.value).toBe(false);
    store.setEnabled(true);
    expect(store.active.value).toBe(false);
    expect(store.cameraTransform('ir')).toBeNull();
    expect(store.cameraToCamera('eo', 'ir')).toBeNull();
  });

  it('activates only when enabled, available, and not suspended', () => {
    const store = makeResolvedStore();
    expect(store.available.value).toBe(true);
    expect(store.active.value).toBe(false);
    store.setEnabled(true);
    expect(store.active.value).toBe(true);
    store.setSuspended(true);
    expect(store.active.value).toBe(false);
    expect(store.cameraTransform('ir')).toBeNull();
    store.setSuspended(false);
    expect(store.active.value).toBe(true);
  });

  it('exposes a display transform for warped cameras and null for the reference', () => {
    const store = makeResolvedStore();
    store.setEnabled(true);
    expect(store.cameraTransform('eo')).toBeNull();
    const m = store.cameraTransform('ir');
    expect(m).not.toBeNull();
    expectPointClose(applyHomography(m as Matrix3, [1, 1]), [101, 1]);
    // Unknown camera also renders unwarped.
    expect(store.cameraTransform('uv')).toBeNull();
  });

  it('maps cross-camera points through the reference', () => {
    const store = makeResolvedStore();
    store.setEnabled(true);
    expectPointClose(store.mapCameraPoint('ir', 'eo', [0, 0]) as Point, [100, 0]);
    expectPointClose(store.mapCameraPoint('eo', 'ir', [100, 0]) as Point, [0, 0]);
    expect(store.mapCameraPoint('eo', 'flir', [0, 0])).toBeNull();
  });

  it('becomes unavailable when a camera set collapses to one entry', () => {
    const store = new AlignedViewStore();
    store.setTransforms('eo', { eo: IDENTITY3 });
    store.setEnabled(true);
    expect(store.available.value).toBe(false);
    expect(store.active.value).toBe(false);
  });
});
