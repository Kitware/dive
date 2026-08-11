// @vitest-environment jsdom
/// <reference types="vitest" />
import {
  defineComponent, h, nextTick, ref, Ref,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
import Track from '../../track';
import TrackList from './TrackList.vue';

interface MockCameraStore {
  camMap: Ref<Map<string, { trackStore: undefined }>>;
  getTracksMerged: (id: number) => Track | undefined;
  getTrackProjection: (id: number) => Track | undefined;
  getAnyPossibleTrack: (id: number) => Track | undefined;
}

interface MockTrackFilters {
  allTypes: Ref<string[]>;
  checkedIDs: Ref<number[]>;
  filteredAnnotations: Ref<{
    annotation: ReturnType<typeof sortedTrack>;
    context: { confidencePairIndex: number };
  }[]>;
  hierarchyActive: Ref<boolean>;
}

const state = vi.hoisted(() => ({
  cameraStore: null as unknown as MockCameraStore,
  trackFilters: null as unknown as MockTrackFilters,
}));

vi.mock('dive-common/vue-utilities/prompt-service', () => ({
  usePrompt: () => ({ prompt: vi.fn() }),
}));

vi.mock('../../use/useVirtualScrollTo', () => ({
  default: () => ({ virtualList: ref(null), scrollPreventDefault: vi.fn() }),
}));

vi.mock('../../provides', () => ({
  useEditingMode: () => ref(false),
  useHandler: () => ({
    trackSplit: vi.fn(),
    removeTrack: vi.fn(),
    trackAdd: vi.fn(),
    trackSelect: vi.fn(),
    trackSelectNext: vi.fn(),
  }),
  useSelectedTrackId: () => ref(null),
  useTrackFilters: () => state.trackFilters,
  useTime: () => ({ frame: ref(0), isPlaying: ref(false) }),
  useReadOnlyMode: () => ref(false),
  useTrackStyleManager: () => ({
    typeStyling: ref({ color: (type: string) => `color:${type}` }),
  }),
  useMultiSelectList: () => ref([]),
  useCameraStore: () => state.cameraStore,
  useSelectedCamera: () => ref('singleCam'),
  usePendingSaveCount: () => ref(0),
}));

function sortedTrack(track: Track) {
  return {
    id: track.id,
    begin: track.begin,
    end: track.end,
    confidencePairs: track.confidencePairs,
    getType: (index = 0) => track.confidencePairs[index][0],
  };
}

function mountList(
  tracks: Track[],
  contextIndexes: number[],
  hierarchyActive = true,
  filtered = tracks.map((track, index) => ({
    annotation: sortedTrack(track),
    context: { confidencePairIndex: contextIndexes[index] },
  })),
) {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  state.trackFilters = {
    allTypes: ref(['root', 'child', 'leaf']),
    checkedIDs: ref(tracks.map(({ id }) => id)),
    filteredAnnotations: ref(filtered),
    hierarchyActive: ref(hierarchyActive),
  };
  state.cameraStore = {
    camMap: ref(new Map([['singleCam', { trackStore: undefined }]])),
    getTracksMerged: (id: number) => byId.get(id),
    getTrackProjection: (id: number) => byId.get(id),
    getAnyPossibleTrack: (id: number) => byId.get(id),
  };
  // `@vue/test-utils` types a mount target as a Vue 2 constructor, which a `defineComponent`
  // SFC is not, so the list renders from a host that captures the real instance. It stays
  // unstubbed to keep shallow semantics for its own children.
  let child: InstanceType<typeof TrackList> | undefined;
  const Host = defineComponent({
    setup: () => () => h(TrackList, {
      props: {
        compact: true,
        newTrackMode: 'Track',
        newTrackType: 'unknown',
        hotkeysDisabled: false,
      },
      ref: (instance) => {
        if (instance && !(instance instanceof Element)) {
          child = instance as InstanceType<typeof TrackList>;
        }
      },
    }),
  });
  const wrapper = shallowMount(Host, { stubs: { TrackList: false } });
  if (!child) {
    throw new Error('TrackList did not mount');
  }
  return { wrapper, vm: child };
}

describe('TrackList hierarchy display', () => {
  it.each([
    ['monotone leaf', [['root', 0.9], ['child', 0.8], ['leaf', 0.7]], 2, 'leaf'],
    ['non-monotone leaf', [['root', 0.2], ['child', 0.9], ['leaf', 0.6]], 2, 'leaf'],
    ['unchecked-leaf roll-up', [['root', 0.9], ['child', 0.8], ['leaf', 0.7]], 1, 'child'],
  ] as [string, [string, number][], number, string][])(
    'passes the context-selected type, confidence index, and color for %s',
    (_name, pairs, pairIndex, expectedType) => {
      const track = new Track(1, {
        confidencePairs: pairs,
        features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
      });
      const { wrapper } = mountList([track], [pairIndex]);
      const listView = wrapper.findComponent({ name: 'BottomBarTrackListView' });
      const items = listView.props('virtualListItems') as unknown[];
      const getItemProps = listView.props('getItemProps') as (item: unknown) => Record<string, unknown>;
      expect(getItemProps(items[0])).toMatchObject({
        trackType: expectedType,
        displayPairIndex: pairIndex,
        color: `color:${expectedType}`,
      });
    },
  );

  it('sorts hierarchy confidence by the context pair and flat confidence by pair zero', async () => {
    const first = new Track(1, {
      confidencePairs: [['root', 0.9], ['leaf', 0.4]],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    });
    const second = new Track(2, {
      confidencePairs: [['root', 0.5], ['leaf', 0.8]],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    });
    const { wrapper, vm } = mountList([first, second], [1, 1]);
    vm.handleSort('confidence');
    expect(vm.filteredTracks.map(({ annotation }) => annotation.id)).toEqual([2, 1]);

    state.trackFilters.hierarchyActive.value = false;
    await nextTick();
    expect(vm.filteredTracks.map(({ annotation }) => annotation.id)).toEqual([1, 2]);
    const listView = wrapper.findComponent({ name: 'BottomBarTrackListView' });
    const items = listView.props('virtualListItems') as unknown[];
    const getItemProps = listView.props('getItemProps') as (item: unknown) => Record<string, unknown>;
    expect(getItemProps(items[0])).toMatchObject({ displayPairIndex: 0 });
  });

  it('renders no row or fake type for an excluded empty hierarchy vector', () => {
    const track = new Track(1, {
      confidencePairs: [],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    });
    const annotation = sortedTrack(track);
    const getType = vi.spyOn(annotation, 'getType');

    const { wrapper } = mountList([track], [-1], true, [{
      annotation,
      context: { confidencePairIndex: -1 },
    }]);
    const listView = wrapper.findComponent({ name: 'BottomBarTrackListView' });
    expect(listView.props('virtualListItems')).toEqual([]);
    expect(getType).not.toHaveBeenCalled();
  });
});
