// @vitest-environment jsdom
import { shallowMount } from '@vue/test-utils';
import { reactive, ref } from 'vue';
import { videoSearchListIndexes } from '../api';
import VideoSearchContext from './VideoSearchContext.vue';

const mocks = vi.hoisted(() => ({ search: null as unknown }));
vi.mock('../api', () => ({ videoSearchListIndexes: vi.fn() }));
vi.mock('../useVideoSearch', () => ({ useVideoSearch: () => mocks.search }));
vi.mock('../useSearchChips', () => ({ createSearchChips: () => ({ chips: ref({}), dispose: vi.fn() }) }));
vi.mock('../store/jobs', () => ({ runningJobs: ref([]) }));
vi.mock('dive-common/vue-utilities/prompt-service', () => ({ usePrompt: () => ({ prompt: vi.fn() }) }));
vi.mock('vue-media-annotator/provides', () => ({
  useCameraStore: () => ({}),
  useHandler: () => ({}),
  useSelectedCamera: () => ref('left'),
  useSelectedTrackId: () => ref(null),
  useTime: () => ({ frame: ref(0) }),
}));
vi.mock('./VideoSearchResultsGrid.vue', () => ({ default: {} }));

it.each([0, 2])('offers index creation on the Query Datasets page with %s indexes', async (count) => {
  mocks.search = {
    datasetId: 'current-sequence',
    state: reactive({
      installed: true, status: { datasetCount: count }, results: [], busy: null, selectedStream: null,
    }),
    refreshStatus: vi.fn(),
    selectIndex: vi.fn(),
  };
  vi.mocked(videoSearchListIndexes).mockResolvedValue([
    { name: 'Alpha', datasetId: 'a', streamName: 'a-stream' },
    { name: 'Beta', datasetId: 'b', streamName: 'b-stream' },
  ]);
  const wrapper = shallowMount(VideoSearchContext, { stubs: ['v-btn', 'v-select', 'v-divider', 'v-dialog', 'v-card', 'v-card-title', 'v-card-text', 'v-card-actions', 'v-text-field', 'v-spacer'] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const link = wrapper.findAll('v-btn-stub').wrappers.find((button) => button.text().includes(count ? 'Build a new index' : 'Create index'));
  expect(link).toBeDefined();
  expect((wrapper.vm as unknown as { buildLocation: unknown }).buildLocation).toEqual({
    name: 'query', query: { datasetIds: 'current-sequence', view: 'datasets' },
  });
  expect(wrapper.findAll('v-select-stub').length).toBe(count ? 1 : 0);
  expect(wrapper.text()).not.toContain('Add to index');
  expect(wrapper.text()).not.toContain('Remove');
  if (count) {
    expect((wrapper.vm as unknown as { indexChoices: unknown }).indexChoices).toEqual([
      { text: 'All indexed sequences', value: '' },
      { text: 'Alpha', value: 'a-stream' },
      { text: 'Beta', value: 'b-stream' },
    ]);
  } else expect(wrapper.text()).toContain('No search index is available yet');
  wrapper.destroy();
});
