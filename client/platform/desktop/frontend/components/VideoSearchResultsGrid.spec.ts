// @vitest-environment jsdom
import { shallowMount } from '@vue/test-utils';
import {
  computed, markRaw, reactive, ref,
} from 'vue';
import type { ReviewItem } from 'dive-common/review/types';
import VideoSearchResultsGrid from './VideoSearchResultsGrid.vue';

const mocks = vi.hoisted(() => ({ search: null as unknown }));
vi.mock('../useVideoSearch', () => ({ useVideoSearch: () => mocks.search }));
vi.mock('dive-common/vue-utilities/prompt-service', () => ({ usePrompt: () => ({ prompt: vi.fn() }) }));
vi.mock('dive-common/use/useReview', () => ({ useReview: () => null }));
vi.mock('vue-media-annotator/provides', () => ({ useHandler: () => null }));
vi.mock('./VideoSearchResultsSpace.vue', () => ({
  default: {
    name: 'VideoSearchResultsSpace',
    props: ['points', 'cells', 'exemplarUrl', 'loading', 'error', 'missingCount'],
    render: (h: (tag: string) => unknown) => h('div'),
  },
}));

function item(key: string, frame: number): ReviewItem {
  return {
    key,
    datasetId: 'a',
    trackId: frame,
    primary: { frame, bounds: [0, 0, 10, 10] },
    frames: [{ frame, bounds: [0, 0, 10, 10] }],
    keyframeCount: 1,
    type: '',
    confidence: 1,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(refs: string[]) {
  const results = refs.map((ref, i) => ({ ref, stream_id: 's', relevancy_score: 1 - i * 0.1 }));
  const search = {
    state: reactive({
      results, adjudications: {} as Record<string, string>, busy: null, error: null, iteration: 0, queryGeneration: 1, modelAvailable: false,
    }),
    resultDatasetName: () => null,
    resultIsLocal: () => true,
    resultDatasetId: () => 'a',
    mark: vi.fn(),
    refine: vi.fn(),
    layoutResults: vi.fn(async (wanted: string[]) => ({
      success: true,
      points: wanted.map((ref, i) => ({ ref, position: [i, 0, 0] as [number, number, number], distance: i * 2 })),
      missing: [],
    })),
  };
  mocks.search = search;
  const items = computed(() => search.state.results.map((r, i) => item(r.ref, i)));
  // Raw: the root instance would otherwise observe the prop and unwrap its refs.
  const searchChips = markRaw({
    items,
    itemsByRef: computed(() => new Map(items.value.map((i) => [i.key, i]))),
    chips: ref<Record<string, string>>({ [refs[0]]: 'data:chip' }),
    store: {
      chips: ref({}),
      sequences: ref({}),
      transforms: ref({}),
      sequenceTransforms: ref({}),
      failures: ref({}),
      ensurePrimary: vi.fn(),
      ensureSequences: vi.fn(),
      trimQueues: vi.fn(),
      setOptions: vi.fn(),
    },
    dispose: vi.fn(),
  });
  const memory = reactive({
    page: 0, hideReviewed: false, space: false, spaceCount: 2,
  });
  const wrapper = shallowMount(VideoSearchResultsGrid, {
    propsData: {
      inline: true, searchChips, memory, exemplarUrl: 'file:///exemplar.jpg',
    },
    stubs: ['v-card', 'v-toolbar', 'v-toolbar-title', 'v-btn', 'v-btn-toggle', 'v-icon', 'v-spacer', 'v-select', 'v-progress-linear', 'v-alert'],
  });
  return {
    wrapper, search, searchChips, memory,
  };
}

it('only places results in descriptor space once the 3D view is chosen, remembering the choice', async () => {
  const {
    wrapper, search, searchChips, memory,
  } = mount(['0:1', '0:2', '0:3']);
  await flush();
  expect(search.layoutResults).not.toHaveBeenCalled();
  expect(wrapper.findComponent({ name: 'VideoSearchResultsSpace' }).exists()).toBe(false);

  (wrapper.vm as unknown as { space: boolean }).space = true;
  await flush();
  expect(search.layoutResults).toHaveBeenCalledWith(['0:1', '0:2']);
  expect(searchChips.store.ensurePrimary).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ key: '0:1' })]));
  expect(memory).toMatchObject({ space: true, spaceCount: 2 });
  const space = wrapper.findComponent({ name: 'VideoSearchResultsSpace' });
  expect(space.exists()).toBe(true);
  expect(space.props('points')).toEqual([
    { key: '0:1', position: [0, 0, 0] }, { key: '0:2', position: [1, 0, 0] },
  ]);
  expect(space.props('cells')).toMatchObject([
    {
      key: '0:1', rank: 1, chip: 'data:chip', distance: 0, score: 1,
    },
    {
      key: '0:2', rank: 2, chip: null, distance: 2,
    },
  ]);
  expect(space.props('exemplarUrl')).toBe('file:///exemplar.jpg');

  (wrapper.vm as unknown as { spaceCount: number }).spaceCount = 3;
  await flush();
  expect(search.layoutResults).toHaveBeenLastCalledWith(['0:1', '0:2', '0:3']);
  expect(memory.spaceCount).toBe(3);

  // Refinement re-ranks under the same refs: the layout is fetched again.
  search.state.results = [...search.state.results].reverse();
  search.state.iteration = 1;
  await flush();
  expect(search.layoutResults).toHaveBeenLastCalledWith(['0:3', '0:2', '0:1']);
  wrapper.destroy();
});

it('marks and opens results from the 3D view through the shared session', async () => {
  const { wrapper, search } = mount(['0:1', '0:2']);
  (wrapper.vm as unknown as { space: boolean }).space = true;
  await flush();
  const space = wrapper.findComponent({ name: 'VideoSearchResultsSpace' });
  space.vm.$emit('mark', '0:2', 'negative');
  expect(search.mark).toHaveBeenCalledWith('0:2', 'negative');
  space.vm.$emit('open', '0:2');
  expect(wrapper.emitted('open-result')?.[0]).toEqual(['a', 1, undefined]);
  wrapper.destroy();
});
