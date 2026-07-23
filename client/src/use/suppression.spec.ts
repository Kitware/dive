/// <reference types="vitest" />
import Track, { TrackData } from '../track';
import {
  isSuppressedAttributeValue, hasSuppressionAttribute,
  getSuppressedTrackIds, normalizeSuppressionThreshold, DEFAULT_SUPPRESSION_THRESHOLD,
} from './suppression';

function makeTrack(overrides: Partial<TrackData> = {}): Track {
  return Track.fromJSON({
    attributes: {},
    begin: 0,
    end: 0,
    confidencePairs: [['seal', 0.9]],
    features: [
      {
        frame: 0,
        bounds: [0, 0, 10, 10],
        keyframe: true,
        interpolate: false,
      },
    ],
    meta: {},
    id: 1,
    ...overrides,
  });
}

function makeStore(tracks: Track[]) {
  return {
    intervalTree: {
      search: () => tracks.map((t) => String(t.id)),
    },
    getPossible: (id: number) => tracks.find((t) => t.id === id),
  } as unknown as Parameters<typeof getSuppressedTrackIds>[0];
}

describe('isSuppressedAttributeValue', () => {
  it('accepts common truthy flag spellings', () => {
    expect(isSuppressedAttributeValue(true)).toBe(true);
    expect(isSuppressedAttributeValue(1)).toBe(true);
    expect(isSuppressedAttributeValue('true')).toBe(true);
    expect(isSuppressedAttributeValue('True')).toBe(true);
    expect(isSuppressedAttributeValue('ON')).toBe(true);
    expect(isSuppressedAttributeValue('yes')).toBe(true);
    expect(isSuppressedAttributeValue(' 1 ')).toBe(true);
  });

  it('rejects falsy or unrelated values', () => {
    expect(isSuppressedAttributeValue(false)).toBe(false);
    expect(isSuppressedAttributeValue(0)).toBe(false);
    expect(isSuppressedAttributeValue('false')).toBe(false);
    expect(isSuppressedAttributeValue('off')).toBe(false);
    expect(isSuppressedAttributeValue('')).toBe(false);
    expect(isSuppressedAttributeValue(undefined)).toBe(false);
    expect(isSuppressedAttributeValue(null)).toBe(false);
    expect(isSuppressedAttributeValue({})).toBe(false);
  });
});

describe('hasSuppressionAttribute', () => {
  it('is disabled when no suppression type is configured', () => {
    const track = makeTrack({ attributes: { Suppressed: true } });
    expect(hasSuppressionAttribute(track, 0, undefined)).toBe(false);
    expect(hasSuppressionAttribute(track, 0, '')).toBe(false);
  });

  it('reads a track-level attribute named after the suppression type', () => {
    const track = makeTrack({ attributes: { Suppressed: true } });
    expect(hasSuppressionAttribute(track, 0, 'Suppressed')).toBe(true);
    expect(hasSuppressionAttribute(track, 0, 'OtherName')).toBe(false);
  });

  it('reads a detection-level attribute on the frame', () => {
    const track = makeTrack({
      features: [
        {
          frame: 0,
          bounds: [0, 0, 10, 10],
          keyframe: true,
          interpolate: false,
          attributes: { Suppressed: 'true' },
        },
      ],
    });
    expect(hasSuppressionAttribute(track, 0, 'Suppressed')).toBe(true);
  });

  it('falls back to the previous keyframe on interpolated frames', () => {
    const track = makeTrack({
      begin: 0,
      end: 10,
      features: [
        {
          frame: 0,
          bounds: [0, 0, 10, 10],
          keyframe: true,
          interpolate: true,
          attributes: { Suppressed: true },
        },
        {
          frame: 10,
          bounds: [10, 10, 20, 20],
          keyframe: true,
          interpolate: true,
        },
      ],
    });
    expect(hasSuppressionAttribute(track, 5, 'Suppressed')).toBe(true);
  });

  it('is false for an unflagged detection', () => {
    const track = makeTrack();
    expect(hasSuppressionAttribute(track, 0, 'Suppressed')).toBe(false);
  });
});

describe('normalizeSuppressionThreshold', () => {
  it('converts a valid percent to a fraction', () => {
    expect(normalizeSuppressionThreshold(95)).toBeCloseTo(0.95, 6);
    expect(normalizeSuppressionThreshold(50)).toBeCloseTo(0.5, 6);
    expect(normalizeSuppressionThreshold(100)).toBeCloseTo(1.0, 6);
    expect(normalizeSuppressionThreshold(1)).toBeCloseTo(0.01, 6);
  });

  it('falls back to the default for missing or out-of-range values', () => {
    expect(normalizeSuppressionThreshold(undefined)).toBe(DEFAULT_SUPPRESSION_THRESHOLD);
    expect(normalizeSuppressionThreshold(0)).toBe(DEFAULT_SUPPRESSION_THRESHOLD);
    expect(normalizeSuppressionThreshold(-5)).toBe(DEFAULT_SUPPRESSION_THRESHOLD);
    expect(normalizeSuppressionThreshold(150)).toBe(DEFAULT_SUPPRESSION_THRESHOLD);
    expect(normalizeSuppressionThreshold(NaN)).toBe(DEFAULT_SUPPRESSION_THRESHOLD);
  });
});

describe('getSuppressedTrackIds', () => {
  const region = makeTrack({
    id: 1,
    confidencePairs: [['Suppressed', 1]],
    features: [{
      frame: 0, bounds: [0, 0, 100, 100], keyframe: true, interpolate: false,
    }],
  });
  const covered = makeTrack({
    id: 2,
    features: [{
      frame: 0, bounds: [10, 10, 90, 90], keyframe: true, interpolate: false,
    }],
  });
  const outside = makeTrack({
    id: 3,
    features: [{
      frame: 0, bounds: [200, 200, 250, 250], keyframe: true, interpolate: false,
    }],
  });
  const barelyTouching = makeTrack({
    id: 4,
    features: [{
      frame: 0, bounds: [95, 95, 195, 195], keyframe: true, interpolate: false,
    }],
  });

  it('suppresses covered detections; the bbox prefilter spares the rest', () => {
    const store = makeStore([region, covered, outside, barelyTouching]);
    expect(getSuppressedTrackIds(store, 0, 'Suppressed')).toEqual(new Set([2]));
  });

  it('returns empty when disabled or no regions exist', () => {
    expect(getSuppressedTrackIds(makeStore([covered]), 0, 'Suppressed'))
      .toEqual(new Set());
    expect(getSuppressedTrackIds(makeStore([region, covered]), 0, undefined))
      .toEqual(new Set());
  });

  it('memoizes per revision and recomputes when the revision changes', () => {
    const store = makeStore([region, covered]);
    const first = getSuppressedTrackIds(store, 0, 'Suppressed', undefined, { revision: 1 });
    const again = getSuppressedTrackIds(store, 0, 'Suppressed', undefined, { revision: 1 });
    expect(again).toBe(first);

    // Simulate an edit: the detection moves out from under the region
    covered.setFeature({
      frame: 0,
      bounds: [300, 300, 380, 380],
      keyframe: true,
      interpolate: false,
    });
    // Same revision still serves the memoized result
    expect(getSuppressedTrackIds(store, 0, 'Suppressed', undefined, { revision: 1 }))
      .toBe(first);
    // A new revision recomputes with the updated geometry
    expect(getSuppressedTrackIds(store, 0, 'Suppressed', undefined, { revision: 2 }))
      .toEqual(new Set());
  });
});

describe('getSuppressedTrackIds threshold', () => {
  // A 100x100 region and a detection half-covered by it (x in [50, 150))
  const region = makeTrack({
    id: 1,
    confidencePairs: [['Suppressed', 1]],
    features: [{
      frame: 0, bounds: [0, 0, 100, 100], keyframe: true, interpolate: false,
    }],
  });
  const halfCovered = makeTrack({
    id: 2,
    features: [{
      frame: 0, bounds: [50, 0, 150, 100], keyframe: true, interpolate: false,
    }],
  });
  const fullyCovered = makeTrack({
    id: 3,
    features: [{
      frame: 0, bounds: [10, 10, 90, 90], keyframe: true, interpolate: false,
    }],
  });
  const store = makeStore([region, halfCovered, fullyCovered]);

  it('at the default (99%) only the fully covered detection is suppressed', () => {
    expect(getSuppressedTrackIds(store, 0, 'Suppressed')).toEqual(new Set([3]));
  });

  it('a lower threshold also suppresses the half-covered detection', () => {
    expect(getSuppressedTrackIds(store, 0, 'Suppressed', 50)).toEqual(new Set([2, 3]));
  });

  it('out-of-range thresholds fall back to the default', () => {
    expect(getSuppressedTrackIds(store, 0, 'Suppressed', 0)).toEqual(new Set([3]));
    expect(getSuppressedTrackIds(store, 0, 'Suppressed', 200)).toEqual(new Set([3]));
  });
});

describe('rasterized region polygons', () => {
  // A 32-gon (circle-ish) region: enough vertices to trigger the mask path
  const n = 32;
  const circle: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n;
    circle.push([50 + 45 * Math.cos(a), 50 + 45 * Math.sin(a)]);
  }
  const polyRegion = makeTrack({
    id: 1,
    confidencePairs: [['Suppressed', 1]],
    features: [{
      frame: 0,
      bounds: [5, 5, 95, 95],
      keyframe: true,
      interpolate: false,
      geometry: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[...circle, circle[0]]] },
          properties: { key: '' },
        }],
      },
    }],
  });
  // Fully inside the circle
  const inCircle = makeTrack({
    id: 2,
    features: [{
      frame: 0, bounds: [40, 40, 60, 60], keyframe: true, interpolate: false,
    }],
  });
  // Inside the region's bbox but in a corner outside the circle
  const inCorner = makeTrack({
    id: 3,
    features: [{
      frame: 0, bounds: [5, 5, 18, 18], keyframe: true, interpolate: false,
    }],
  });

  it('suppresses by the polygon shape, not its bbox', () => {
    const store = {
      intervalTree: { search: () => ['1', '2', '3'] },
      getPossible: (id: number) => [polyRegion, inCircle, inCorner].find((t) => t.id === id),
    } as unknown as Parameters<typeof getSuppressedTrackIds>[0];
    expect(getSuppressedTrackIds(store, 0, 'Suppressed')).toEqual(new Set([2]));
  });
});

describe('polygon detection vs bbox prefilter', () => {
  // Thin strip polygon inside a large bbox: the region covers the strip
  // fully, but only ~10% of the bbox. A bbox-area prefilter at 99% would
  // skip sampling and incorrectly leave the detection unsuppressed.
  const region = makeTrack({
    id: 1,
    confidencePairs: [['Suppressed', 1]],
    features: [{
      frame: 0, bounds: [0, 0, 100, 20], keyframe: true, interpolate: false,
    }],
  });
  const stripPoly: [number, number][] = [
    [0, 0], [100, 0], [100, 10], [0, 10], [0, 0],
  ];
  const thinStrip = makeTrack({
    id: 2,
    features: [{
      frame: 0,
      bounds: [0, 0, 100, 100],
      keyframe: true,
      interpolate: false,
      geometry: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [stripPoly] },
          properties: { key: '' },
        }],
      },
    }],
  });

  it('still suppresses a polygon fully covered even when bbox overlap is low', () => {
    const store = makeStore([region, thinStrip]);
    expect(getSuppressedTrackIds(store, 0, 'Suppressed')).toEqual(new Set([2]));
  });
});
