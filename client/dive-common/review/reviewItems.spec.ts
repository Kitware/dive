import type { TrackData } from 'vue-media-annotator/track';
import {
  attributeMatches,
  buildReviewItems,
  collectAttributeKeys,
  collectTypes,
  cycleIntervalFor,
  frameGeometry,
  groupReviewItems,
  interpolateBounds,
  matchTypePair,
  sampleFrames,
  sortReviewItems,
} from './reviewItems';
import { DEFAULT_REVIEW_QUERY } from './types';

function track(
  id: number,
  pairs: [string, number][],
  frames: number[],
  extra: Partial<TrackData> = {},
): TrackData {
  return {
    id,
    begin: Math.min(...frames),
    end: Math.max(...frames),
    confidencePairs: pairs,
    attributes: {},
    features: frames.map((frame) => ({
      frame, keyframe: true, bounds: [frame, 0, frame + 10, 10],
    })),
    ...extra,
  };
}

describe('sampleFrames', () => {
  it('keeps a single detection as one frame', () => {
    const [only] = track(1, [['a', 1]], [3]).features;
    expect(sampleFrames([only], 8)).toEqual([{ frame: 3, bounds: [3, 0, 13, 10] }]);
  });

  it('samples evenly including both ends and never repeats a frame', () => {
    const { features } = track(1, [['a', 1]], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const frames = sampleFrames(features, 4).map((f) => f.frame);
    expect(frames).toEqual([0, 3, 7, 10]);
    expect(sampleFrames(features, 50)).toHaveLength(11);
  });
});

describe('matchTypePair', () => {
  it('uses the top pair when no type is requested', () => {
    expect(matchTypePair([['fish', 0.4], ['shark', 0.9]], '', 0.5)).toEqual(['shark', 0.9]);
    expect(matchTypePair([['fish', 0.4]], '', 0.5)).toBeNull();
  });

  it('matches the named type against the threshold', () => {
    expect(matchTypePair([['fish', 0.4], ['shark', 0.9]], 'fish', 0.3)).toEqual(['fish', 0.4]);
    expect(matchTypePair([['fish', 0.4], ['shark', 0.9]], 'fish', 0.5)).toBeNull();
    expect(matchTypePair([['shark', 0.9]], 'fish', 0)).toBeNull();
  });

  it('only shows untyped tracks when everything is requested', () => {
    expect(matchTypePair([], '', 0)).toEqual(['', 0]);
    expect(matchTypePair([], '', 0.1)).toBeNull();
  });
});

describe('attributeMatches', () => {
  it('requires presence, then compares as text ignoring case', () => {
    expect(attributeMatches(undefined, '')).toBe(false);
    expect(attributeMatches('Yes', '')).toBe(true);
    expect(attributeMatches('Yes', 'yes')).toBe(true);
    expect(attributeMatches(3, '3')).toBe(true);
    expect(attributeMatches(true, 'false')).toBe(false);
  });
});

describe('buildReviewItems', () => {
  const tracks = [
    track(2, [['fish', 0.8], ['shark', 0.2]], [10, 11, 12]),
    track(1, [['shark', 0.95]], [5]),
    track(3, [['fish', 0.05]], [0]),
    { ...track(4, [['fish', 0.9]], [7]), features: [{ frame: 7, keyframe: false }] },
  ];

  it('filters by type and threshold and orders by track id', () => {
    const items = buildReviewItems('ds', tracks, { ...DEFAULT_REVIEW_QUERY, type: 'fish', threshold: 0.1 }, 8);
    expect(items.map((i) => i.trackId)).toEqual([2]);
    expect(items[0]).toMatchObject({
      key: 'ds#2', type: 'fish', confidence: 0.8, keyframeCount: 3,
    });
    expect(items[0].primary.frame).toBe(10);
    expect(items[0].frames).toHaveLength(3);
  });

  it('shows every class above the threshold when no type is picked', () => {
    const items = buildReviewItems('ds', tracks, { ...DEFAULT_REVIEW_QUERY, type: '', threshold: 0.5 }, 8);
    expect(items.map((i) => [i.trackId, i.type])).toEqual([[1, 'shark'], [2, 'fish']]);
  });

  it('finds track and detection attributes', () => {
    const withAttributes = [
      track(1, [['fish', 1]], [0, 1], { attributes: { verified: true } }),
      {
        ...track(2, [['fish', 1]], [4, 5, 6]),
        features: [
          { frame: 4, keyframe: true, bounds: [0, 0, 1, 1] as [number, number, number, number] },
          {
            frame: 5, keyframe: true, bounds: [0, 0, 1, 1] as [number, number, number, number], attributes: { occluded: 'partial' },
          },
          {
            frame: 6, keyframe: true, bounds: [0, 0, 1, 1] as [number, number, number, number], attributes: { occluded: 'partial' },
          },
        ],
      },
    ];
    const query = { ...DEFAULT_REVIEW_QUERY, mode: 'attribute' as const };
    const verified = buildReviewItems('ds', withAttributes, { ...query, attributeKey: 'verified' }, 8);
    expect(verified.map((i) => i.trackId)).toEqual([1]);
    expect(verified[0].matchedAttribute).toEqual({ key: 'verified', value: true, scope: 'track' });

    const occluded = buildReviewItems('ds', withAttributes, { ...query, attributeKey: 'occluded', attributeValue: 'PARTIAL' }, 8);
    expect(occluded).toHaveLength(1);
    expect(occluded[0]).toMatchObject({ key: 'ds#2@5', trackId: 2, type: 'fish' });
    expect(occluded[0].primary.frame).toBe(5);
    expect(occluded[0].frames.map((f) => f.frame)).toEqual([5, 6]);

    const trackOnly = buildReviewItems('ds', withAttributes, { ...query, attributeKey: 'occluded', attributeScope: 'track' }, 8);
    expect(trackOnly).toHaveLength(0);
  });
});

describe('sortReviewItems', () => {
  const items = [
    ...buildReviewItems('b', [track(1, [['a', 0.5]], [9]), track(2, [['a', 0.9]], [3])], DEFAULT_REVIEW_QUERY, 8),
    ...buildReviewItems('a', [track(7, [['a', 0.7]], [1])], DEFAULT_REVIEW_QUERY, 8),
  ];

  it('orders by dataset selection order, confidence or frame', () => {
    const keys = (order: Parameters<typeof sortReviewItems>[1]) => (
      sortReviewItems(items, order, ['a', 'b']).map((i) => i.key)
    );
    expect(keys('dataset')).toEqual(['a#7', 'b#1', 'b#2']);
    expect(keys('confidence-asc')).toEqual(['b#1', 'a#7', 'b#2']);
    expect(keys('confidence-desc')).toEqual(['b#2', 'a#7', 'b#1']);
    expect(keys('frame')).toEqual(['a#7', 'b#2', 'b#1']);
  });
});

describe('vocabularies', () => {
  it('collects sorted types and attribute keys', () => {
    const tracks = [
      track(1, [['zeta', 0.1], ['alpha', 0.9]], [0], { attributes: { trackAttr: 1 } }),
      {
        ...track(2, [['beta', 1]], [0]),
        features: [{
          frame: 0, keyframe: true, bounds: [0, 0, 1, 1] as [number, number, number, number], attributes: { detAttr: 'x' },
        }],
      },
    ];
    expect(collectTypes(tracks)).toEqual(['alpha', 'beta', 'zeta']);
    expect(collectAttributeKeys(tracks, {
      defined: {
        belongs: 'track', datatype: 'text', name: 'defined', key: 'track_defined',
      },
    })).toEqual(['defined', 'detAttr', 'trackAttr']);
  });
});

describe('frameGeometry', () => {
  it('reads polygons and head/tail points from the GeoJSON features', () => {
    const geometry = frameGeometry({
      frame: 2,
      bounds: [0, 0, 10, 10],
      geometry: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { key: '' },
            geometry: { type: 'Polygon', coordinates: [[[1, 1], [9, 1], [9, 9], [1, 1]]] },
          },
          { type: 'Feature', properties: { key: 'head' }, geometry: { type: 'Point', coordinates: [3, 4] } },
          { type: 'Feature', properties: { key: 'tail' }, geometry: { type: 'Point', coordinates: [7, 8] } },
          { type: 'Feature', properties: { key: 'HeadTails' }, geometry: { type: 'LineString', coordinates: [[3, 4], [7, 8]] } },
        ],
      },
    });
    expect(geometry).toEqual({
      polygons: [[[1, 1], [9, 1], [9, 9]]],
      head: [3, 4],
      tail: [7, 8],
    });
  });

  it('falls back to the feature head/tail fields and leaves plain boxes bare', () => {
    expect(frameGeometry({ frame: 0, bounds: [0, 0, 1, 1], head: [1, 2] })).toEqual({ head: [1, 2] });
    expect(frameGeometry({ frame: 0, bounds: [0, 0, 1, 1] })).toEqual({});
  });
});

describe('cycleIntervalFor', () => {
  it('plays consecutive frames at the dataset rate and sparse samples proportionally slower', () => {
    const consecutive = [0, 1, 2, 3].map((frame) => ({ frame, bounds: [0, 0, 1, 1] as [number, number, number, number] }));
    expect(cycleIntervalFor(consecutive, 10, 400)).toBe(100);
    const sparse = [0, 30, 60, 90].map((frame) => ({ frame, bounds: [0, 0, 1, 1] as [number, number, number, number] }));
    expect(cycleIntervalFor(sparse, 30, 400)).toBe(1000);
    expect(cycleIntervalFor(sparse, 1, 400)).toBe(2000);
    expect(cycleIntervalFor(consecutive, 120, 400)).toBe(33);
  });

  it('falls back when the rate is unknown or there is nothing to cycle', () => {
    const one = [{ frame: 5, bounds: [0, 0, 1, 1] as [number, number, number, number] }];
    expect(cycleIntervalFor(one, 30, 400)).toBe(400);
    expect(cycleIntervalFor([...one, { frame: 6, bounds: [0, 0, 1, 1] }], 0, 400)).toBe(400);
  });
});

describe('interpolateBounds', () => {
  it('holds the nearest box at the ends and interpolates between keyframes', () => {
    const t = track(1, [['fish', 1]], [0, 10]);
    expect(interpolateBounds(t, 5)).toEqual([5, 0, 15, 10]);
    expect(interpolateBounds(t, -3)).toEqual([0, 0, 10, 10]);
    expect(interpolateBounds(t, 20)).toEqual([10, 0, 20, 10]);
    expect(interpolateBounds(t, 10)).toEqual([10, 0, 20, 10]);
    expect(interpolateBounds({ ...t, features: [] }, 3)).toBeNull();
  });
});

describe('groupReviewItems', () => {
  it('joins a track across the cameras of a rig with aligned frames and box-less gaps', () => {
    const left = track(7, [['fish', 1]], [0, 4]);
    const right = track(7, [['fish', 1]], [4, 8]);
    const query = { ...DEFAULT_REVIEW_QUERY, threshold: 0 };
    const items = [
      ...buildReviewItems('rig/right', [right], query, 8),
      ...buildReviewItems('rig/left', [left], query, 8),
      ...buildReviewItems('solo', [track(1, [['fish', 1]], [2])], query, 8),
    ];
    const membership = (id: string) => (id.startsWith('rig/')
      ? { parent: 'rig', camera: id.slice(4), rank: id === 'rig/left' ? 0 : 1 }
      : undefined);
    const tracks: Record<string, TrackData> = { 'rig/left': left, 'rig/right': right };
    const entries = groupReviewItems(items, membership, (item) => tracks[item.datasetId], 8);

    expect(entries.map((e) => e.key)).toEqual(['rig#7', 'solo#1']);
    const rig = entries[0];
    expect(rig.labels).toEqual(['left', 'right']);
    expect(rig.items.map((i) => i.datasetId)).toEqual(['rig/left', 'rig/right']);
    // Both cameras show frames 0, 4 and 8; the sides without a detection are interpolated.
    expect(rig.items[0].frames.map((f) => [f.frame, f.missing ?? false])).toEqual([[0, false], [4, false], [8, true]]);
    expect(rig.items[1].frames.map((f) => [f.frame, f.missing ?? false])).toEqual([[0, true], [4, false], [8, false]]);
    expect(rig.items[0].frames[2].bounds).toEqual([4, 0, 14, 10]);
    expect(entries[1].labels).toEqual(['']);
  });
});
