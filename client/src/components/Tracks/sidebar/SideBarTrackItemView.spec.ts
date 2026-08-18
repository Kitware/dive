// @vitest-environment jsdom
/// <reference types="vitest" />
import { defineComponent, h, ref } from 'vue';
import { shallowMount } from '@vue/test-utils';
import Track from '../../../track';
import SideBarTrackItemView from './SideBarTrackItemView.vue';

const state = vi.hoisted(() => ({ assignTrackType: vi.fn() }));

vi.mock('../../../provides', () => ({
  useHandler: () => ({ trackSeek: vi.fn(), removeTrack: vi.fn() }),
  useReadOnlyMode: () => ref(false),
  useTrackFilters: () => ({
    allTypes: ref(['root', 'leaf']),
    hierarchyIndex: ref(undefined),
    updateCheckedId: vi.fn(),
  }),
  useCameraStore: () => ({
    camMap: ref(new Map([['singleCam', {}]])),
    assignTrackType: state.assignTrackType,
  }),
  useTrackStyleManager: () => ({ typeStyling: ref({}) }),
}));

/**
 * `@vue/test-utils` types a mount target as a Vue 2 constructor, which a `defineComponent`
 * SFC is not, so the row is rendered from a host that captures the real instance. It is left
 * unstubbed to keep shallow semantics for its own children.
 */
function mountRow(props: Record<string, unknown>) {
  let child: InstanceType<typeof SideBarTrackItemView> | undefined;
  const Host = defineComponent({
    setup: () => () => h(SideBarTrackItemView, {
      props,
      ref: (instance) => {
        if (instance && !(instance instanceof Element)) {
          child = instance as InstanceType<typeof SideBarTrackItemView>;
        }
      },
    }),
  });
  const wrapper = shallowMount(Host, { stubs: { SideBarTrackItemView: false } });
  if (!child) {
    throw new Error('SideBarTrackItemView did not mount');
  }
  return { wrapper, vm: child };
}

describe('SideBarTrackItemView classification editing', () => {
  beforeEach(() => state.assignTrackType.mockClear());

  it('routes assignment through the logical-track command', () => {
    const track = new Track(1, {
      confidencePairs: [['root', 0.9], ['leaf', 0.7]],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    });
    const { vm } = mountRow({
      selected: true,
      trackType: 'leaf',
      itemStyle: {},
      color: '#fff',
      track,
      inputValue: true,
      isTrack: true,
      feature: {},
      keyframeDisabled: false,
      frame: 0,
      toggleKeyframe: vi.fn(),
      clickToggleInterpolation: vi.fn(),
      toggleInterpolation: vi.fn(),
      toggleAllInterpolation: vi.fn(),
      gotoPrevious: vi.fn(),
      gotoNext: vi.fn(),
      editing: false,
    });
    vm.setTrackType('new leaf');

    expect(state.assignTrackType).toHaveBeenCalledWith(1, 'new leaf', {
      hierarchyIndex: undefined,
      replaceType: 'leaf',
    });
  });
});
