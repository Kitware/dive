import { effectScope } from 'vue';
import {
  loadConfig, textQuery, videoInfo, videoSearchIndexStatus, videoSearchListIndexes,
  videoSearchRemoveIndex, videoSearchDeleteIndex,
} from './api';
import { recentHistory, runningJobs } from './store/jobs';
import { createQueryPage } from './useQueryPage';

const extractedFrames: number[] = [];

vi.mock('./api', () => ({
  videoSearchRemoveIndex: vi.fn(),
  videoSearchDeleteIndex: vi.fn(),
  loadConfig: vi.fn(),
  videoInfo: vi.fn(),
  textQuery: vi.fn(async () => ({ success: true, detections: [] })),
  videoSearchIndexStatus: vi.fn(),
  videoSearchListIndexes: vi.fn(async () => []),
  listScoringDatasets: vi.fn(async () => []),
  videoSearchInstalled: vi.fn(async () => true),
  segmentationSam3Installed: vi.fn(async () => ({ installed: false })),
}));
vi.mock('./store/jobs', async () => {
  const { ref } = await import('vue');
  return { runningJobs: ref([]), recentHistory: ref([]), queuedGpuJobs: ref([]) };
});
vi.mock('./useVideoSearch', () => ({
  createVideoSearch: () => {
    const state: {
      results: { ref: string; stream_id: string }[];
      streams: Record<string, { datasetId: string }>;
      busy: boolean;
      sessionOpen: boolean;
      adjudications: Record<string, string | undefined>;
      iteration: number;
      queryGeneration: number;
      modelAvailable: boolean;
    } = {
      results: [],
      streams: {},
      busy: false,
      sessionOpen: false,
      adjudications: {},
      iteration: 0,
      queryGeneration: 0,
      modelAvailable: false,
    };
    return {
      state,
      resultDatasetId: (result: { stream_id: string }) => state.streams[result.stream_id]?.datasetId ?? null,
      getMediaInfoFor: vi.fn(async () => ({
        type: 'video',
        fps: 10,
        getImagePath: () => '/videos/clip.mp4',
      })),
      imageForDatasetFrame: vi.fn(async (_id: string, frame: number) => {
        extractedFrames.push(frame);
        return `/frames/${frame}.png`;
      }),
    };
  },
}));

it('selects the first stereo camera and checks the index of that camera', async () => {
  vi.mocked(loadConfig).mockResolvedValue({
    name: 'Stereo',
    type: 'multi',
    multiCamMedia: {
      cameras: { right: { type: 'video' }, left: { type: 'video' } }, cameraOrder: ['left', 'right'], defaultDisplay: 'right',
    },
  } as never);
  vi.mocked(videoSearchIndexStatus).mockResolvedValue({ indexed: true } as never);
  const scope = effectScope();
  const page = scope.run(() => createQueryPage())!;
  try {
    await page.addDatasets(['stereo']);
    expect(page.datasets.value).toEqual([expect.objectContaining({ id: 'stereo/left', name: 'Stereo / left', index: 'indexed' })]);
    expect(videoSearchIndexStatus).toHaveBeenCalledWith('stereo/left');
    expect(page.indexedIds.value).toEqual(['stereo/left']);
  } finally { scope.stop(); }
});

it.each([undefined, 0, 1])('restores an index row after leaving while its job finishes (%s)', async (exitCode) => {
  recentHistory.value.splice(0);
  vi.mocked(loadConfig).mockResolvedValue({ name: 'Sequence', type: 'video' } as never);
  vi.mocked(videoSearchIndexStatus).mockResolvedValue({ indexed: exitCode === 0 } as never);
  const firstScope = effectScope();
  const first = firstScope.run(() => createQueryPage())!;
  first.datasets.value.forEach((dataset) => first.removeDataset(dataset.id));
  await first.addDataset('sequence');
  firstScope.stop();
  recentHistory.value.push({
    job: {
      key: 'index-job',
      title: 'Add search index (detections)',
      datasetIds: ['sequence'],
      startTime: new Date(),
      endTime: exitCode === undefined ? undefined : new Date(),
      exitCode: exitCode ?? null,
    },
    truncatedLogs: exitCode === 1 ? ['ERROR: index failed'] : [],
    totalLogLength: 0,
  } as never);
  const secondScope = effectScope();
  const second = secondScope.run(() => createQueryPage())!;
  await second.refreshAvailable();
  expect(second.datasets.value).toEqual([expect.objectContaining({
    id: 'sequence', index: ({ running: 'building', 0: 'indexed', 1: 'error' } as Record<string, string>)[exitCode ?? 'running'],
  })]);
  if (exitCode === 1) expect(second.datasets.value[0].error).toContain('index failed');
  secondScope.stop();
});

it('discovers completed indexes even without a prior page selection', async () => {
  recentHistory.value.splice(0);
  vi.mocked(loadConfig).mockResolvedValue({ name: 'Existing', type: 'video' } as never);
  vi.mocked(videoSearchIndexStatus).mockResolvedValue({ indexed: true } as never);
  vi.mocked(videoSearchListIndexes).mockResolvedValue([{
    datasetId: 'existing', name: 'Existing', streamName: 'stream', method: 'detections',
  }]);
  const scope = effectScope();
  const page = scope.run(() => createQueryPage())!;
  page.datasets.value.forEach((dataset) => page.removeDataset(dataset.id));
  await page.refreshAvailable();
  expect(page.indexedIds.value).toEqual(['existing']);
  scope.stop();
});

it('keeps index membership visible independently of the build selection and refreshes after removal', async () => {
  recentHistory.value.splice(0);
  vi.mocked(loadConfig).mockResolvedValue({ name: 'Indexed', type: 'video' } as never);
  vi.mocked(videoSearchIndexStatus).mockResolvedValue({ indexed: true } as never);
  vi.mocked(videoSearchListIndexes).mockResolvedValue([{
    datasetId: 'indexed', name: 'Indexed', streamName: 'stream', method: 'detections',
  }]);
  const scope = effectScope();
  const page = scope.run(() => createQueryPage())!;
  await page.refreshAvailable();
  page.removeDataset('indexed');
  expect(page.indexMembers.value.map((member) => member.datasetId)).toEqual(['indexed']);
  vi.mocked(videoSearchRemoveIndex).mockResolvedValue({ success: true });
  vi.mocked(videoSearchListIndexes).mockResolvedValue([]);
  await page.removeFromIndex('indexed');
  expect(videoSearchRemoveIndex).toHaveBeenCalledWith('indexed');
  expect(page.indexMembers.value).toEqual([]);
  scope.stop();
});

it('prevents index deletion during a build and clears membership after deleting the entire index', async () => {
  const scope = effectScope();
  const page = scope.run(() => createQueryPage())!;
  vi.mocked(videoSearchDeleteIndex).mockClear().mockResolvedValue({ success: true });
  runningJobs.value.push({ job: { title: 'Add search index (detections)' } } as never);
  await page.deleteEntireIndex();
  expect(videoSearchDeleteIndex).not.toHaveBeenCalled();
  runningJobs.value.splice(0);
  vi.mocked(videoSearchListIndexes).mockResolvedValue([]);
  vi.mocked(videoSearchIndexStatus).mockResolvedValue({ indexed: false } as never);
  page.search.state.results = [{ ref: 'old-result' }] as never;
  await page.deleteEntireIndex();
  expect(videoSearchDeleteIndex).toHaveBeenCalledOnce();
  expect(page.indexMembers.value).toEqual([]);
  expect(page.search.state.results).toEqual([]);
  expect(page.changingIndex.value).toBe(false);
  scope.stop();
});

it('reports deletion errors without clearing successful index entries', async () => {
  const scope = effectScope();
  const page = scope.run(() => createQueryPage())!;
  page.indexMembers.value = [{
    datasetId: 'indexed', name: 'Indexed', streamName: 'stream', method: 'detections',
  }];
  vi.mocked(videoSearchDeleteIndex).mockRejectedValue(new Error('Permission denied'));
  await page.deleteEntireIndex();
  expect(page.error.value).toBe('Permission denied');
  expect(page.indexMembers.value).toHaveLength(1);
  expect(page.changingIndex.value).toBe(false);
  scope.stop();
});

it('limits results to the listed datasets when onlySelected is on', async () => {
  const scope = effectScope();
  const page = scope.run(() => createQueryPage())!;
  page.datasets.value = [{ id: 'keep', name: 'Keep', index: 'indexed' }];
  page.search.state.streams = {
    keep: { datasetId: 'keep' },
    other: { datasetId: 'other' },
  } as never;
  page.search.state.results = [
    { ref: 'a', stream_id: 'keep' },
    { ref: 'b', stream_id: 'other' },
  ] as never;
  expect(page.results.value.map((result) => result.ref)).toEqual(['a']);
  page.onlySelected.value = false;
  expect(page.results.value.map((result) => result.ref)).toEqual(['a', 'b']);
  scope.stop();
});

it('clears stale query results when an index job finishes', async () => {
  recentHistory.value.splice(0);
  const scope = effectScope();
  const page = scope.run(() => createQueryPage())!;
  page.search.state.sessionOpen = true;
  page.search.state.results = [{ ref: 'stale' }] as never;
  page.search.state.adjudications = { stale: 'positive' } as never;
  page.search.state.modelAvailable = true;
  const generation = page.search.state.queryGeneration;
  recentHistory.value.push({
    job: {
      key: 'index-done',
      title: 'Add search index (detections)',
      datasetIds: ['clip'],
      startTime: new Date(),
      endTime: new Date(),
      exitCode: 0,
    },
    truncatedLogs: [],
    totalLogLength: 0,
  } as never);
  await Promise.resolve();
  expect(page.search.state.sessionOpen).toBe(false);
  expect(page.search.state.results).toEqual([]);
  expect(page.search.state.adjudications).toEqual({});
  expect(page.search.state.modelAvailable).toBe(false);
  expect(page.search.state.queryGeneration).toBe(generation + 1);
  scope.stop();
});

it('plans text-query frames within the probed video length', async () => {
  extractedFrames.length = 0;
  vi.mocked(loadConfig).mockResolvedValue({ name: 'Clip', type: 'video', fps: 10 } as never);
  vi.mocked(videoInfo).mockResolvedValue({
    fps: 30, duration: 2, width: 640, height: 480, frameCount: 60,
  });
  vi.mocked(textQuery).mockResolvedValue({ success: true, detections: [] } as never);
  const scope = effectScope();
  const page = scope.run(() => createQueryPage())!;
  page.datasets.value = [{ id: 'clip', name: 'Clip', index: 'indexed' }];
  page.text.prompt = 'fish';
  page.text.stride = 5;
  page.text.maxFrames = 40;
  await page.runTextQuery();
  // duration 2s × dataset fps 10 → 20 frames → [0, 5, 10, 15]
  expect(extractedFrames).toEqual([0, 5, 10, 15]);
  expect(page.error.value).toBeNull();
  scope.stop();
});
