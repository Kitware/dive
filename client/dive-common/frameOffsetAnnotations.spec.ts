import { describe, expect, it } from 'vitest';
import type { TrackData } from 'vue-media-annotator/track';
import { pendingFrameShifts, shiftTrackData } from './frameOffsetAnnotations';

function track(frames: number[]): TrackData {
  return {
    id: 1,
    attributes: {},
    confidencePairs: [['fish', 1]],
    begin: Math.min(...frames),
    end: Math.max(...frames),
    features: frames.map((frame) => ({ frame, bounds: [0, 0, 1, 1] })),
  };
}

describe('shiftTrackData', () => {
  it('moves every feature and the bounds by the delta', () => {
    const shifted = shiftTrackData(track([3, 4, 5]), 9);
    expect(shifted?.begin).toBe(12);
    expect(shifted?.end).toBe(14);
    expect(shifted?.features.map((f) => f.frame)).toStrictEqual([12, 13, 14]);
  });

  it('drops features that would land before frame 0', () => {
    const shifted = shiftTrackData(track([3, 4, 5]), -4);
    expect(shifted?.features.map((f) => f.frame)).toStrictEqual([0, 1]);
    expect(shifted?.begin).toBe(0);
    expect(shifted?.end).toBe(1);
  });

  it('returns null when nothing survives', () => {
    expect(shiftTrackData(track([0, 1]), -5)).toBeNull();
  });

  it('is the identity at delta 0', () => {
    const data = track([1]);
    expect(shiftTrackData(data, 0)).toBe(data);
  });
});

describe('pendingFrameShifts', () => {
  it('reports only the part of an offset not yet applied', () => {
    expect(pendingFrameShifts({ IR: 9 }, {}, ['EO', 'IR'])).toStrictEqual({ IR: 9 });
    expect(pendingFrameShifts({ IR: 9 }, { IR: 9 }, ['EO', 'IR'])).toStrictEqual({});
    expect(pendingFrameShifts({ IR: 7 }, { IR: 9 }, ['EO', 'IR'])).toStrictEqual({ IR: -2 });
    expect(pendingFrameShifts({}, { IR: 9 }, ['EO', 'IR'])).toStrictEqual({ IR: -9 });
  });
});
