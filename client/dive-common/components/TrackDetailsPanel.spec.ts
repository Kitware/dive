// @vitest-environment jsdom
/// <reference types="vitest" />
import { defineComponent, h, ref } from 'vue';
import { shallowMount } from '@vue/test-utils';
import Track from 'vue-media-annotator/track';
import { createTrackProjection } from 'vue-media-annotator/TrackProjection';
import TrackDetailsPanel from './TrackDetailsPanel.vue';

const state = vi.hoisted(() => ({
  displayPairIndex: vi.fn(() => 1),
  track: null as Track | null,
  multiSelectList: [] as number[],
  acceptTrackType: vi.fn(),
  assignTrackType: vi.fn(),
}));

vi.mock('vue-media-annotator/provides', () => ({
  useSelectedTrackId: () => ref(1),
  useEditingMode: () => ref(false),
  useHandler: () => ({
    trackSelectNext: vi.fn(),
    trackSplit: vi.fn(),
    removeTrack: vi.fn(),
    unstageFromMerge: vi.fn(),
    setAttribute: vi.fn(),
    deleteAttribute: vi.fn(),
    removeGroup: vi.fn(),
    toggleMerge: vi.fn(),
  }),
  useTrackFilters: () => ({
    allTypes: ref(['root', 'leaf']),
    displayPairIndex: state.displayPairIndex,
    hierarchyIndex: ref(undefined),
  }),
  useAttributes: () => ref([]),
  useMultiSelectList: () => ref(state.multiSelectList),
  useTime: () => ({ frame: ref(0) }),
  useReadOnlyMode: () => ref(false),
  useTrackStyleManager: () => ({
    typeStyling: ref({ color: (type: string) => `color:${type}` }),
  }),
  useEditingGroupId: () => ref(null),
  useEditingMultiTrack: () => ref(false),
  useGroupFilterControls: () => ({ allTypes: ref([]) }),
  useCameraStore: () => ({
    camMap: ref(new Map([['singleCam', { groupStore: undefined }]])),
    getAnyTrack: () => state.track,
    getAnyPossibleTrack: () => state.track,
    getTrackProjection: () => createTrackProjection([state.track as Track]),
    acceptTrackType: state.acceptTrackType,
    assignTrackType: state.assignTrackType,
  }),
  useSelectedCamera: () => ref('singleCam'),
}));

/**
 * `@vue/test-utils` types a mount target as a Vue 2 constructor, which a `defineComponent`
 * SFC is not, so the panel is rendered from a host that captures the real instance. It is
 * left unstubbed to keep shallow semantics for its own children.
 */
function mountPanel() {
  let child: InstanceType<typeof TrackDetailsPanel> | undefined;
  const Host = defineComponent({
    setup: () => () => h(TrackDetailsPanel, {
      props: { hotkeysDisabled: false },
      ref: (instance) => {
        if (instance && !(instance instanceof Element)) {
          child = instance as InstanceType<typeof TrackDetailsPanel>;
        }
      },
    }),
  });
  const wrapper = shallowMount(Host, { stubs: { TrackDetailsPanel: false } });
  if (!child) {
    throw new Error('TrackDetailsPanel did not mount');
  }
  return { wrapper, vm: child };
}

describe('TrackDetailsPanel hierarchy summary', () => {
  beforeEach(() => {
    state.displayPairIndex.mockReturnValue(1);
    state.multiSelectList = [];
    state.acceptTrackType.mockClear();
    state.assignTrackType.mockClear();
    state.track = new Track(1, {
      confidencePairs: [['root', 0.9], ['leaf', 0.7]],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    });
  });

  it('passes the selected type, confidence index, and color to the summary TrackItem', () => {
    const { wrapper } = mountPanel();
    const item = wrapper.findComponent({ name: 'TrackItem' });
    expect(item.exists()).toBe(true);
    expect(item.props('trackType')).toBe('leaf');
    expect(item.props('displayPairIndex')).toBe(1);
    expect(item.props('color')).toBe('color:leaf');
  });

  it('falls back to the top pair when no pair passes the filters', () => {
    state.displayPairIndex.mockReturnValue(-1);
    const { wrapper } = mountPanel();
    const item = wrapper.findComponent({ name: 'TrackItem' });
    expect(item.exists()).toBe(true);
    expect(item.props('trackType')).toBe('root');
    expect(item.props('displayPairIndex')).toBe(0);
    expect(item.props('lockTypes')).toBe(false);
  });

  it('omits the header only for an empty confidence vector', () => {
    state.track = new Track(1, {
      confidencePairs: [],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    });
    const { wrapper } = mountPanel();
    expect(wrapper.findComponent({ name: 'TrackItem' }).exists()).toBe(false);
  });

  it('routes Accept Correct Type through the acceptance command', () => {
    const { vm } = mountPanel();
    vm.acceptTrackType('leaf');
    expect(state.acceptTrackType).toHaveBeenCalledWith(1, 'leaf', undefined);
  });

  it('routes bulk assignment through the same hierarchy-aware command', () => {
    state.multiSelectList = [1];
    const { vm } = mountPanel();
    vm.updateMultiTrackType('new leaf');
    vm.updateSelectedTracksType();
    expect(state.assignTrackType).toHaveBeenCalledWith(1, 'new leaf', {
      hierarchyIndex: undefined,
      replaceType: 'leaf',
    });
  });
});
