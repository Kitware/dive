// @vitest-environment jsdom
/// <reference types="vitest" />
import { defineComponent, h, ref } from 'vue';
import { shallowMount } from '@vue/test-utils';
import Track from '../../../track';
import BottomBarTrackItemView from './BottomBarTrackItemView.vue';

const providerState = vi.hoisted(() => ({ setTrackType: vi.fn() }));

vi.mock('../../../provides', () => ({
  useHandler: () => ({ trackSeek: vi.fn(), removeTrack: vi.fn(), trackEdit: vi.fn() }),
  useReadOnlyMode: () => ref(false),
  useTrackFilters: () => ({ allTypes: ref(['root', 'leaf']) }),
  useCameraStore: () => ({ setTrackType: providerState.setTrackType }),
}));

function mountItem(displayPairIndex: number) {
  const track = new Track(1, {
    confidencePairs: [['root', 0.9], ['leaf', 0.7]],
    features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
  });
  Object.preventExtensions(track);
  // `@vue/test-utils` types a mount target as a Vue 2 constructor, which a `defineComponent`
  // SFC is not, so the row renders from a host and stays unstubbed to keep shallow semantics
  // for its own children.
  let child: InstanceType<typeof BottomBarTrackItemView> | undefined;
  const Host = defineComponent({
    setup: () => () => h(BottomBarTrackItemView, {
      ref: (instance) => {
        if (instance && !(instance instanceof Element)) {
          child = instance as InstanceType<typeof BottomBarTrackItemView>;
        }
      },
      props: {
        track,
        trackType: displayPairIndex === 1 ? 'leaf' : 'root',
        displayPairIndex,
        itemStyle: {},
        color: displayPairIndex === 1 ? '#leaf' : '#root',
        editing: false,
        inputValue: true,
        toggleKeyframe: vi.fn(),
        toggleInterpolation: vi.fn(),
        toggleAllInterpolation: vi.fn(),
      },
    }),
  });
  const wrapper = shallowMount(Host, { stubs: { BottomBarTrackItemView: false } });
  if (!child) {
    throw new Error('BottomBarTrackItemView did not mount');
  }
  return { wrapper, vm: child, props: child.$props };
}

describe('BottomBarTrackItemView hierarchy display', () => {
  it('renders and seeds editing from the selected hierarchy pair', () => {
    const { wrapper, vm } = mountItem(1);
    expect(wrapper.find('.track-type-compact').text()).toBe('leaf');
    expect(wrapper.find('.track-confidence-compact').text()).toBe('0.70');
    vm.startEditConfidence(new MouseEvent('click'));
    expect(vm.editConfidenceValue).toBe('0.70');
  });

  it('retains pair-zero type and confidence in flat mode', () => {
    const { wrapper } = mountItem(0);
    expect(wrapper.find('.track-type-compact').text()).toBe('root');
    expect(wrapper.find('.track-confidence-compact').text()).toBe('0.90');
  });
});
