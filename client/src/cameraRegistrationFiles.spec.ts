// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import { describe, expect, it } from 'vitest';

import {
  buildPerCameraRegistrationFiles,
  registrationValuesSummary,
  filterRegistrationValues,
  mergeRegistrationValues,
  CameraRegistrationValues,
} from './cameraRegistrationFiles';

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const SHIFT = [[1, 0, 5], [0, 1, -3], [0, 0, 1]];
const UNSHIFT = [[1, 0, -5], [0, 1, 3], [0, 0, 1]];

function values(partial: Partial<CameraRegistrationValues>): CameraRegistrationValues {
  return {
    homographies: {},
    correspondences: {},
    transformTypes: {},
    source: null,
    ...partial,
  };
}

describe('buildPerCameraRegistrationFiles', () => {
  it('groups each pair under its non-reference camera, sorted', () => {
    const files = buildPerCameraRegistrationFiles(values({
      homographies: {
        'rgb::uv': { AtoB: IDENTITY, BtoA: IDENTITY },
        'ir::rgb': { AtoB: SHIFT, BtoA: UNSHIFT },
      },
    }), 'rgb');
    expect(files.map((f) => f.camera)).toStrictEqual(['ir', 'uv']);
    expect(files.map((f) => f.name)).toStrictEqual(['ir_to_rgb_registration.json', 'uv_to_rgb_registration.json']);
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
    const files = buildPerCameraRegistrationFiles(values({
      homographies: { 'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT } },
    }), null);
    expect(files.map((f) => f.camera)).toStrictEqual(['ir']);
  });

  it('self-identifies files and carries a plain source stamp', () => {
    const source = { producer: 'kamera', run: 'fl07' };
    const [file] = buildPerCameraRegistrationFiles(values({
      homographies: { 'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT } },
      source,
    }), 'rgb');
    expect(file.body.type).toBe('dive-camera-registration');
    expect(file.body.source).toStrictEqual(source);
  });

  it('never stamps files with a mixed composite source', () => {
    const [file] = buildPerCameraRegistrationFiles(values({
      homographies: { 'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT } },
      source: { mixed: true, files: {} },
    }), 'rgb');
    expect('source' in file.body).toBe(false);
  });

  it('serializes correspondences as leftX leftY rightX rightY rows', () => {
    const [file] = buildPerCameraRegistrationFiles(values({
      correspondences: {
        'rgb::ir': [{ id: 1, a: [10, 20], b: [12, 22] }],
      },
    }), 'rgb');
    expect(file.body.pairs[0].points).toStrictEqual([[10, 20, 12, 22]]);
    expect(file.body.pairs[0].leftToRight).toBeNull();
  });
});

describe('filterRegistrationValues', () => {
  const multi = values({
    homographies: {
      'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT },
      'rgb::uv': { AtoB: IDENTITY, BtoA: IDENTITY },
    },
    transformTypes: { 'rgb::ir': 'rigid', 'rgb::uv': 'affine' },
    source: { producer: 'kamera' },
  });

  it('keeps only pairs naming the camera, on either side', () => {
    const filtered = filterRegistrationValues(multi, 'ir');
    expect(Object.keys(filtered.homographies)).toStrictEqual(['rgb::ir']);
    expect(Object.keys(filtered.transformTypes)).toStrictEqual(['rgb::ir']);
    expect(filtered.source).toStrictEqual({ producer: 'kamera' });
  });

  it('yields an empty calibration for an unknown camera', () => {
    expect(registrationValuesSummary(filterRegistrationValues(multi, 'zz')).pairCount).toBe(0);
  });
});

describe('registrationValuesSummary', () => {
  it('counts distinct pairs and names their cameras', () => {
    const summary = registrationValuesSummary(values({
      homographies: { 'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT } },
      correspondences: { 'rgb::uv': [{ id: 1, a: [1, 2], b: [3, 4] }] },
    }));
    expect(summary.pairCount).toBe(2);
    expect(summary.cameras.sort()).toStrictEqual(['ir', 'rgb', 'uv']);
  });
});

describe('mergeRegistrationValues', () => {
  const existing = values({
    homographies: { 'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT } },
    correspondences: { 'rgb::ir': [{ id: 1, a: [1, 2], b: [3, 4] }] },
    transformTypes: { 'rgb::ir': 'rigid' },
    source: { producer: 'kamera', run: 'fl07' },
  });

  it('keeps pairs the import does not name', () => {
    const merged = mergeRegistrationValues(existing, values({
      homographies: { 'rgb::uv': { AtoB: IDENTITY, BtoA: IDENTITY } },
    }), 'calibration_uv.json');
    expect(Object.keys(merged.homographies).sort()).toStrictEqual(['rgb::ir', 'rgb::uv']);
    expect(merged.transformTypes['rgb::ir']).toBe('rigid');
  });

  it('replaces a named pair wholly, dropping stale points and model choice', () => {
    const merged = mergeRegistrationValues(existing, values({
      homographies: { 'rgb::ir': { AtoB: IDENTITY, BtoA: IDENTITY } },
    }), 'calibration_ir.json');
    expect(merged.homographies['rgb::ir'].AtoB).toStrictEqual(IDENTITY);
    expect(merged.correspondences['rgb::ir']).toBeUndefined();
    expect(merged.transformTypes['rgb::ir']).toBeUndefined();
  });

  it('keeps the existing stamp when the import carries none', () => {
    const merged = mergeRegistrationValues(existing, values({
      homographies: { 'rgb::uv': { AtoB: IDENTITY, BtoA: IDENTITY } },
    }), 'calibration_uv.json');
    expect(merged.source).toStrictEqual({ producer: 'kamera', run: 'fl07' });
  });

  it('keeps a single stamp when both agree, mixes when they disagree', () => {
    const agreeing = mergeRegistrationValues(existing, values({
      source: { producer: 'kamera', run: 'fl07' },
    }), 'calibration_uv.json');
    expect(agreeing.source).toStrictEqual({ producer: 'kamera', run: 'fl07' });

    const disagreeing = mergeRegistrationValues(existing, values({
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
