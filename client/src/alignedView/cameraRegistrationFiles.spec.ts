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
    observations: {},
    transformTypes: {},
    source: null,
    ...partial,
  };
}

/** A minimal manual observation with the given points. */
function observation(points: [number, number, number, number][], extra = {}) {
  return {
    imageA: 'a_0000.jpg',
    imageB: 'b_0000.tif',
    frame: 0 as number | null,
    enabled: true,
    source: 'manual',
    points: points.map(([ax, ay, bx, by], i) => ({
      id: i + 1, a: [ax, ay] as [number, number], b: [bx, by] as [number, number],
    })),
    ...extra,
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
      observations: [],
      leftToRight: SHIFT,
      rightToLeft: UNSHIFT,
      transformType: 'similarity',
    }]);
    expect(files[0].body.version).toBe(2);
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

  it('serializes observations with identity, provenance, and flattened point rows', () => {
    const [file] = buildPerCameraRegistrationFiles(values({
      observations: {
        'rgb::ir': [observation([[10, 20, 12, 22]], {
          imageA: 'rgb_0412.jpg',
          imageB: 'ir_0412.tif',
          frame: 412,
          source: 'minima_loftr',
          stats: { numInliers: 1 },
        })],
      },
    }), 'rgb');
    const [row] = file.body.pairs[0].observations!;
    expect(row).toStrictEqual({
      frame: 412,
      imageLeft: 'rgb_0412.jpg',
      imageRight: 'ir_0412.tif',
      enabled: true,
      source: 'minima_loftr',
      points: [[10, 20, 12, 22]],
      stats: { numInliers: 1 },
    });
    // Points live ONLY inside observations: no flattened duplicate.
    expect('points' in file.body.pairs[0]).toBe(false);
    expect(file.body.pairs[0].leftToRight).toBeNull();
  });

  it('omits the advisory frame for unresolved observations', () => {
    const [file] = buildPerCameraRegistrationFiles(values({
      observations: {
        'rgb::ir': [observation([[1, 2, 3, 4]], { frame: null })],
      },
    }), 'rgb');
    expect('frame' in file.body.pairs[0].observations![0]).toBe(false);
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
      observations: { 'rgb::uv': [observation([[1, 2, 3, 4]])] },
    }));
    expect(summary.pairCount).toBe(2);
    expect(summary.cameras.sort()).toStrictEqual(['ir', 'rgb', 'uv']);
  });
});

describe('mergeRegistrationValues', () => {
  const existing = values({
    homographies: { 'rgb::ir': { AtoB: SHIFT, BtoA: UNSHIFT } },
    observations: { 'rgb::ir': [observation([[1, 2, 3, 4]])] },
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

  it('replaces a matrix-only named pair wholly, dropping stale points and model choice', () => {
    const merged = mergeRegistrationValues(existing, values({
      homographies: { 'rgb::ir': { AtoB: IDENTITY, BtoA: IDENTITY } },
    }), 'calibration_ir.json');
    expect(merged.homographies['rgb::ir'].AtoB).toStrictEqual(IDENTITY);
    expect(merged.observations['rgb::ir']).toBeUndefined();
    expect(merged.transformTypes['rgb::ir']).toBeUndefined();
  });

  it('merges at observation granularity within a named pair', () => {
    const base = values({
      observations: {
        'rgb::ir': [
          observation([[1, 2, 3, 4]], { imageA: 'rgb_0001.jpg', imageB: 'ir_0001.tif' }),
          observation([[5, 6, 7, 8]], {
            imageA: 'rgb_0002.jpg', imageB: 'ir_0002.tif', source: 'minima_loftr',
          }),
        ],
      },
    });
    // A fresh pipeline result for one image pair replaces its own prior
    // observation and keeps the hand-picked one it doesn't cover.
    const merged = mergeRegistrationValues(base, values({
      homographies: { 'rgb::ir': { AtoB: IDENTITY, BtoA: IDENTITY } },
      observations: {
        'rgb::ir': [observation([[9, 9, 9, 9], [8, 8, 8, 8]], {
          imageA: 'rgb_0002.jpg', imageB: 'ir_0002.tif', source: 'minima_loftr',
        })],
      },
    }), 'registration.json');
    const list = merged.observations['rgb::ir'];
    expect(list).toHaveLength(2);
    const manual = list.find((obs) => obs.source === 'manual');
    expect(manual?.points).toHaveLength(1);
    const matcher = list.find((obs) => obs.source === 'minima_loftr');
    expect(matcher?.points).toHaveLength(2);
    expect(merged.homographies['rgb::ir'].AtoB).toStrictEqual(IDENTITY);
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
