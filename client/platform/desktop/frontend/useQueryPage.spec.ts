import { effectScope } from 'vue';
import {
  loadConfig, videoSearchIndexStatus, videoSearchListIndexes, videoSearchRemoveIndex, videoSearchDeleteIndex,
} from './api';
import { recentHistory, runningJobs } from './store/jobs';
import { createQueryPage } from './useQueryPage';

vi.mock('./api', () => ({
  videoSearchRemoveIndex: vi.fn(),
  videoSearchDeleteIndex: vi.fn(),
  loadConfig: vi.fn(),
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
vi.mock('./useVideoSearch', () => ({ createVideoSearch: () => ({ state: { results: [], streams: {}, busy: false } }) }));

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
  vi.mocked(videoSearchListIndexes).mockResolvedValue([{ datasetId: 'existing', name: 'Existing', streamName: 'stream' }]);
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
  vi.mocked(videoSearchListIndexes).mockResolvedValue([{ datasetId: 'indexed', name: 'Indexed', streamName: 'stream' }]);
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
  page.indexMembers.value = [{ datasetId: 'indexed', name: 'Indexed', streamName: 'stream' }];
  vi.mocked(videoSearchDeleteIndex).mockRejectedValue(new Error('Permission denied'));
  await page.deleteEntireIndex();
  expect(page.error.value).toBe('Permission denied');
  expect(page.indexMembers.value).toHaveLength(1);
  expect(page.changingIndex.value).toBe(false);
  scope.stop();
});
