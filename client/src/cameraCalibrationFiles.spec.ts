// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import { describe, expect, it } from 'vitest';

import {
  buildPerCameraCalibrationFiles,
  calibrationValuesSummary,
  filterCalibrationValues,
  mergeCalibrationValues,
  CameraCalibrationValues,
} from './cameraCalibrationFiles';

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const SHIFT = [[1, 0, 5], [0, 1, -3], [0, 0, 1]];
const UNSHIFT = [[1, 0, -5], [0, 1, 3], [0, 0, 1]];

function values(partial: Partial<CameraCalibrationValues>): CameraCalibrationValues {
  return {
    homographies: {},
    correspondences: {},
    transformTypes: {},
    source: null,
    ...partial,
  };
}

describe('buildPerCameraCalibrationFiles', () => {
  it('groups each pair under its non-reference camera, sorted', () => {
    const files = buildPerCameraCalibrationFiles(values({
      homographies: {
        'rgb::uv': { AtoB: IDENTITY, BtoA: IDENTITY },
        'ir::rgb': { AtoB: SHIFT, BtoA: UNSHIFT },
      },
    }), 'rgb');
    expect(files.map((f) => f.camera)).toStrictEqual(['ir', 'uv']);
    expect(files.map((f) => f.name)).toStrictEqual(['calibration_ir.json', 'calibration_uv.json']);
    // The pair whose RIGHT camera is the reference files under its left.
    expect(files[0].body.pairs).toStrictEqual([{
      left: 'ir',
      right: 'rgb',
      points: [],
      leftToRight: SHIFT,
      rightToLeft: UNSHIFT,
      transformType: 'similarity',
    }]);
  });

  it('falls back to right-camera grouping without a reference', () => {
    const files = buildPerCameraCalibrationFiles(values({
      homographies: { 'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT } },
    }), null);
    expect(files.map((f) => f.camera)).toStrictEqual(['ir']);
  });

  it('self-identifies files and carries a plain source stamp', () => {
    const source = { producer: 'kamera', run: 'fl07' };
    const [file] = buildPerCameraCalibrationFiles(values({
      homographies: { 'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT } },
      source,
    }), 'rgb');
    expect(file.body.type).toBe('dive-camera-calibration');
    expect(file.body.source).toStrictEqual(source);
  });

  it('never stamps files with a mixed composite source', () => {
    const [file] = buildPerCameraCalibrationFiles(values({
      homographies: { 'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT } },
      source: { mixed: true, files: {} },
    }), 'rgb');
    expect('source' in file.body).toBe(false);
  });

  it('serializes correspondences as leftX leftY rightX rightY rows', () => {
    const [file] = buildPerCameraCalibrationFiles(values({
      correspondences: {
        'rgb::ir': [{ id: 1, a: [10, 20], b: [12, 22] }],
      },
    }), 'rgb');
    expect(file.body.pairs[0].points).toStrictEqual([[10, 20, 12, 22]]);
    expect(file.body.pairs[0].leftToRight).toBeNull();
  });
});

describe('filterCalibrationValues', () => {
  const multi = values({
    homographies: {
      'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT },
      'rgb::uv': { AtoB: IDENTITY, BtoA: IDENTITY },
    },
    transformTypes: { 'rgb::ir': 'rigid', 'rgb::uv': 'affine' },
    source: { producer: 'kamera' },
  });

  it('keeps only pairs naming the camera, on either side', () => {
    const filtered = filterCalibrationValues(multi, 'ir');
    expect(Object.keys(filtered.homographies)).toStrictEqual(['rgb::ir']);
    expect(Object.keys(filtered.transformTypes)).toStrictEqual(['rgb::ir']);
    expect(filtered.source).toStrictEqual({ producer: 'kamera' });
  });

  it('yields an empty calibration for an unknown camera', () => {
    expect(calibrationValuesSummary(filterCalibrationValues(multi, 'zz')).pairCount).toBe(0);
  });
});

describe('calibrationValuesSummary', () => {
  it('counts distinct pairs and names their cameras', () => {
    const summary = calibrationValuesSummary(values({
      homographies: { 'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT } },
      correspondences: { 'rgb::uv': [{ id: 1, a: [1, 2], b: [3, 4] }] },
    }));
    expect(summary.pairCount).toBe(2);
    expect(summary.cameras.sort()).toStrictEqual(['ir', 'rgb', 'uv']);
  });
});

describe('mergeCalibrationValues', () => {
  const existing = values({
    homographies: { 'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT } },
    correspondences: { 'rgb::ir': [{ id: 1, a: [1, 2], b: [3, 4] }] },
    transformTypes: { 'rgb::ir': 'rigid' },
    source: { producer: 'kamera', run: 'fl07' },
  });

  it('keeps pairs the import does not name', () => {
    const merged = mergeCalibrationValues(existing, values({
      homographies: { 'rgb::uv': { AtoB: IDENTITY, BtoA: IDENTITY } },
    }), 'calibration_uv.json');
    expect(Object.keys(merged.homographies).sort()).toStrictEqual(['rgb::ir', 'rgb::uv']);
    expect(merged.transformTypes['rgb::ir']).toBe('rigid');
  });

  it('replaces a named pair wholly, dropping stale points and model choice', () => {
    const merged = mergeCalibrationValues(existing, values({
      homographies: { 'rgb::ir': { AtoB: IDENTITY, BtoA: IDENTITY } },
    }), 'calibration_ir.json');
    expect(merged.homographies['rgb::ir'].AtoB).toStrictEqual(IDENTITY);
    expect(merged.correspondences['rgb::ir']).toBeUndefined();
    expect(merged.transformTypes['rgb::ir']).toBeUndefined();
  });

  it('keeps the existing stamp when the import carries none', () => {
    const merged = mergeCalibrationValues(existing, values({
      homographies: { 'rgb::uv': { AtoB: IDENTITY, BtoA: IDENTITY } },
    }), 'calibration_uv.json');
    expect(merged.source).toStrictEqual({ producer: 'kamera', run: 'fl07' });
  });

  it('keeps a single stamp when both agree, mixes when they disagree', () => {
    const agreeing = mergeCalibrationValues(existing, values({
      source: { producer: 'kamera', run: 'fl07' },
    }), 'calibration_uv.json');
    expect(agreeing.source).toStrictEqual({ producer: 'kamera', run: 'fl07' });

    const disagreeing = mergeCalibrationValues(existing, values({
      source: { producer: 'kamera', run: 'fl09' },
    }), 'calibration_uv.json');
    expect(disagreeing.source).toStrictEqual({
      mixed: true,
      files: {
        previous: { producer: 'kamera', run: 'fl07' },
        'calibration_uv.json': { producer: 'kamera', run: 'fl09' },
      },
    });
  });
});
