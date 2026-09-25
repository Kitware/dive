import type { DatasetConfig } from 'dive-common/apispec';
import type { TrackData } from 'vue-media-annotator/track';
import { buildReviewStatistics, timelineStepPath, TIMELINE_BINS } from './statistics';

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
  expect(row.duration).toBe(40);
  expect(row.unit).toBe('s');
  expect(row.bins.slice(0, 50)).toEqual(Array(50).fill(1));
  expect(row.bins.slice(50, 100)).toEqual(Array(50).fill(2));
  expect(row.bins.slice(100)).toEqual(Array(100).fill(0));
  expect(empty.duration).toBe(1);
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

it('combines camera timelines by parent, unions matching IDs, and keeps per-type steps', () => {
  const result = buildReviewStatistics([
    {
      config: config('rig/left', { fps: 10 }),
      sequenceId: 'rig',
      sequenceName: 'Stereo',
      tracks: [
        track({ begin: 0, end: 9 }),
      ],
    },
    {
      config: config('rig/right', { fps: 20 }),
      sequenceId: 'rig',
      sequenceName: 'Stereo',
      tracks: [
        track({ begin: 10, end: 39 }),
        track({
          id: 2, begin: 20, end: 39, confidencePairs: [['shark', 1]],
        }),
      ],
    },
  ]);
  expect(result.timelines).toHaveLength(1);
  const [row] = result.timelines;
  expect(row).toMatchObject({
    id: 'rig', name: 'Stereo', cameraCount: 2, count: 2, duration: 2, unit: 's',
  });
  expect(row.series.map((series) => series.name)).toEqual(['fish', 'shark']);
  expect(row.series[0].bins).toEqual(Array(TIMELINE_BINS).fill(1));
  expect(row.series[1].bins.slice(0, 100)).toEqual(Array(100).fill(0));
  expect(row.bins.slice(100)).toEqual(Array(100).fill(2));
});

it('keeps gaps between cameras and falls back to frames if any camera lacks FPS', () => {
  const result = buildReviewStatistics([
    { config: config('rig/a', { fps: 0 }), sequenceId: 'rig', tracks: [track({ end: 9 })] },
    { config: config('rig/b'), sequenceId: 'rig', tracks: [track({ begin: 30, end: 39 })] },
  ]);
  expect(result.timelines[0].unit).toBe('frames');
  expect(result.timelines[0].count).toBe(1);
  expect(result.timelines[0].bins.slice(50, 150)).toEqual(Array(100).fill(0));
});

it('draws horizontal step plateaus instead of diagonal spikes', () => {
  expect(timelineStepPath([0, 2, 2, 0], 2, 100, 24)).toBe(
    'M0,24 H25 V4 H75 V24 H100 V24 Z',
  );
});
