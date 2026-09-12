import { effectScope } from 'vue';
import { loadConfig, videoSearchIndexStatus } from './api';
import { createQueryPage } from './useQueryPage';

vi.mock('./api', () => ({ loadConfig: vi.fn(), videoSearchIndexStatus: vi.fn() }));
vi.mock('./store/jobs', async () => {
  const { ref } = await import('vue');
  return { runningJobs: ref([]) };
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
