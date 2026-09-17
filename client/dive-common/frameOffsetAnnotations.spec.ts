import { describe, expect, it } from 'vitest';
import type { TrackData } from 'vue-media-annotator/track';
import type { GroupData } from 'vue-media-annotator/Group';
import {
  pendingFrameShifts, shiftAnnotationRecords, shiftGroupData, shiftTrackData,
} from './frameOffsetAnnotations';

function track(frames: number[], id = 1): TrackData {
  return {
    id,
    attributes: {},
    confidencePairs: [['fish', 1]],
    begin: Math.min(...frames),
    end: Math.max(...frames),
    features: frames.map((frame) => ({ frame, bounds: [0, 0, 1, 1] })),
  };
}

function group(members: GroupData['members'], id = 1): GroupData {
  const ranges = Object.values(members).flatMap((m) => m.ranges);
  return {
    id,
    attributes: {},
    confidencePairs: [['school', 1]],
    begin: Math.min(...ranges.map(([b]) => b)),
    end: Math.max(...ranges.map(([, e]) => e)),
    members,
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

  it('rebounds to the first surviving feature across a gap', () => {
    const shifted = shiftTrackData(track([3, 10]), -5);
    expect(shifted?.features.map((f) => f.frame)).toStrictEqual([5]);
    expect(shifted?.begin).toBe(5);
    expect(shifted?.end).toBe(5);
  });

  it('returns null when nothing survives', () => {
    expect(shiftTrackData(track([0, 1]), -5)).toBeNull();
  });

  it('is the identity at delta 0', () => {
    const data = track([1]);
    expect(shiftTrackData(data, 0)).toBe(data);
  });
});

describe('shiftGroupData', () => {
  it('moves and clips member ranges, dropping emptied members', () => {
    const shifted = shiftGroupData(group({
      1: { ranges: [[2, 6], [10, 20]] },
      2: { ranges: [[0, 1]] },
    }), -4);
    expect(shifted?.members).toStrictEqual({ 1: { ranges: [[0, 2], [6, 16]] } });
    expect(shifted?.begin).toBe(0);
    expect(shifted?.end).toBe(16);
  });

  it('returns null when no member survives', () => {
    expect(shiftGroupData(group({ 1: { ranges: [[0, 1]] } }), -2)).toBeNull();
  });
});

describe('shiftAnnotationRecords', () => {
  it('shifts a keyed annotation file and counts what fell off', () => {
    const result = shiftAnnotationRecords(
      { 1: track([3, 4], 1), 2: track([0], 2) },
      { 1: group({ 2: { ranges: [[0, 0]] } }) },
      -2,
    );
    expect(Object.keys(result.tracks)).toStrictEqual(['1']);
    expect(result.tracks[1].begin).toBe(1);
    expect(result.groups).toStrictEqual({});
    expect(result.dropped).toBe(2);
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
