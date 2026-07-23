/// <reference types="vitest" />
import Track, { TrackData } from '../track';
import { getSuppressedTrackIds } from './suppression';

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

describe('getSuppressedTrackIds', () => {
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
    const first = getSuppressedTrackIds(store, 0, 'Suppressed', { revision: 1 });
    const again = getSuppressedTrackIds(store, 0, 'Suppressed', { revision: 1 });
    expect(again).toBe(first);

    // Simulate an edit: the detection moves out from under the region
    covered.setFeature({
      frame: 0,
      bounds: [300, 300, 380, 380],
      keyframe: true,
      interpolate: false,
    });
    // Same revision still serves the memoized result
    expect(getSuppressedTrackIds(store, 0, 'Suppressed', { revision: 1 })).toBe(first);
    // A new revision recomputes with the updated geometry
    expect(getSuppressedTrackIds(store, 0, 'Suppressed', { revision: 2 }))
      .toEqual(new Set());
  });
});
