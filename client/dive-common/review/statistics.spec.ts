import type { DatasetConfig } from 'dive-common/apispec';
import type { TrackData } from 'vue-media-annotator/track';
import { buildReviewStatistics, TIMELINE_BINS } from './statistics';

const config = (id: string, extra: Partial<DatasetConfig> = {}): DatasetConfig => ({
  id,
  name: id,
  imageData: [],
  videoUrl: undefined,
  type: 'video',
  fps: 10,
  createdAt: '',
  subType: null,
  multiCamMedia: null,
  ...extra,
});
const track = (extra: Partial<TrackData> = {}): TrackData => ({
  id: 1, begin: 0, end: 9, confidencePairs: [['fish', 0.8]], attributes: {}, features: [], ...extra,
});

it('counts every qualifying category once per track using each dataset threshold', () => {
  const result = buildReviewStatistics([
    { config: config('a', { confidenceFilters: { default: 0.9, fish: 0 } }), tracks: [track({ confidencePairs: [['fish', 0], ['fish', 0.5], ['animal', 1], ['shark', 0.8]] })] },
    { config: config('b', { confidenceFilters: { default: 0.9 } }), tracks: [track()] },
  ]);
  expect(result.trackCount).toBe(1);
  expect(Object.fromEntries(result.categories.map((row) => [row.name, row.count]))).toEqual({ fish: 1, animal: 1 });
  expect(result.timelines.find((row) => row.id === 'b')?.count).toBe(0);
});

it('separates attribute scope and values, includes false/zero, and excludes filtered tracks', () => {
  const result = buildReviewStatistics([{
    config: config('a'),
    tracks: [
      track({
        attributes: {
          checked: false, size: 0, absent: null, userAttributes: {},
        },
        features: [
          { frame: 0, attributes: { checked: true } }, { frame: 2, attributes: { checked: true } },
        ],
      }),
      track({ id: 2, confidencePairs: [['fish', 0.01]], attributes: { hidden: true } }),
    ],
  }]);
  expect(result.attributes.map(({
    name, value, scope, count,
  }) => ({
    name, value, scope, count,
  }))).toEqual([
    {
      name: 'checked', value: 'true', scope: 'Detection', count: 2,
    },
    {
      name: 'checked', value: 'false', scope: 'Track', count: 1,
    },
    {
      name: 'size', value: '0', scope: 'Track', count: 1,
    },
  ]);
});

it('sorts by capture time newest first, ignores import date, and places undated rows last', () => {
  const result = buildReviewStatistics([
    { config: config('undated', { createdAt: '2099-01-01' }), tracks: [] },
    { config: config('older', { imageData: [{ filename: 'image.jpg', url: '', timestamp: 1700000000 }] }), tracks: [] },
    { config: config('newer_20250101_120000.mp4'), tracks: [] },
  ]);
  expect(result.timelines.map((row) => row.id)).toEqual(['newer_20250101_120000.mp4', 'older', 'undated']);
});

it('bins inclusive track spans, preserves empty media and below-threshold frame extent', () => {
  const result = buildReviewStatistics([{
    config: config('a'),
    tracks: [
      track({ begin: 0, end: 199 }), track({ id: 2, begin: 100, end: 199 }),
      track({ id: 3, end: 399, confidencePairs: [['fish', 0.01]] }),
    ],
  }, { config: config('empty', { imageData: Array.from({ length: 10 }, () => ({ filename: '', url: '' })) }), tracks: [] }]);
  const [row, empty] = result.timelines;
  expect(row.frameCount).toBe(400);
  expect(row.bins.slice(0, 50)).toEqual(Array(50).fill(1));
  expect(row.bins.slice(50, 100)).toEqual(Array(50).fill(2));
  expect(row.bins.slice(100)).toEqual(Array(100).fill(0));
  expect(empty.frameCount).toBe(10);
  expect(empty.bins.every((count) => count === 0)).toBe(true);
  expect(empty.annotatedExtent).toBe(false);
});

it('keeps unclassified annotations and counts camera annotations independently', () => {
  const result = buildReviewStatistics(['rig/left', 'rig/right'].map((id) => ({
    config: config(id), tracks: [track({ confidencePairs: [] })],
  })));
  expect(result.categories[0]).toMatchObject({ name: '(unclassified)', count: 2 });
  expect(result.timelines).toHaveLength(2);
});

it('bounds timeline size for large selections', () => {
  const result = buildReviewStatistics(Array.from({ length: 1000 }, (_, i) => ({
    config: config(String(i)), tracks: [track({ end: 1e9 })],
  })));
  expect(result.trackCount).toBe(1000);
  expect(result.timelines.every((row) => row.bins.length === TIMELINE_BINS)).toBe(true);
});
