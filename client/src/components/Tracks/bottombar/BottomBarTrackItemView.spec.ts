// @vitest-environment jsdom
/// <reference types="vitest" />
import { defineComponent, h, ref } from 'vue';
import { shallowMount } from '@vue/test-utils';
import Track from '../../../track';
import BottomBarTrackItemView from './BottomBarTrackItemView.vue';

const providerState = vi.hoisted(() => ({
  assignTrackType: vi.fn(),
  setTrackPairConfidence: vi.fn(),
  setTrackNotes: vi.fn(),
  setTrackAttribute: vi.fn(),
  setTrackFirstFeatureAttribute: vi.fn(),
}));

vi.mock('../../../provides', () => ({
  useHandler: () => ({ trackSeek: vi.fn(), removeTrack: vi.fn(), trackEdit: vi.fn() }),
  useReadOnlyMode: () => ref(false),
  useTrackFilters: () => ({
    allTypes: ref(['root', 'leaf']),
    hierarchyIndex: ref(undefined),
  }),
  useCameraStore: () => ({
    assignTrackType: providerState.assignTrackType,
    setTrackPairConfidence: providerState.setTrackPairConfidence,
    setTrackNotes: providerState.setTrackNotes,
    setTrackAttribute: providerState.setTrackAttribute,
    setTrackFirstFeatureAttribute: providerState.setTrackFirstFeatureAttribute,
  }),
}));

function mountItem(displayPairIndex: number) {
  const track = new Track(1, {
    begin: 0,
    end: 0,
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('routes type assignment through the logical-track command', () => {
    const { vm, props } = mountItem(1);
    vm.setEditTypeValue('new leaf');
    vm.saveType();

    expect(providerState.assignTrackType).toHaveBeenCalledWith(1, 'new leaf', {
      hierarchyIndex: undefined,
      replaceType: 'leaf',
      confidence: 0.7,
    });
    expect(props.track.confidencePairs).toEqual([['root', 0.9], ['leaf', 0.7]]);
  });

  it.each(['0.99', '1.00'])('routes confidence %s as a pair update', (value) => {
    const { vm } = mountItem(1);
    vm.setEditConfidenceValue(value);
    vm.saveConfidence();

    expect(providerState.setTrackPairConfidence).toHaveBeenCalledWith(1, 'leaf', Number(value));
  });

  it('routes notes and both attribute scopes through logical-track commands', () => {
    const wrapper = mountItem(1);
    const vm = wrapper.vm as unknown as {
      setEditNotesValue: (value: string) => void;
      saveNotes: () => void;
      editingAttributeKey: string | null;
      setEditAttributeValue: (value: string) => void;
      saveAttribute: () => void;
    };
    vm.setEditNotesValue('reviewed');
    vm.saveNotes();
    vm.editingAttributeKey = 'track_quality';
    vm.setEditAttributeValue('high');
    vm.saveAttribute();
    vm.editingAttributeKey = 'detection_occluded';
    vm.setEditAttributeValue('yes');
    vm.saveAttribute();

    expect(providerState.setTrackNotes).toHaveBeenCalledWith(1, 'reviewed');
    expect(providerState.setTrackAttribute).toHaveBeenCalledWith(1, 'quality', 'high');
    expect(providerState.setTrackFirstFeatureAttribute)
      .toHaveBeenCalledWith(1, 'occluded', 'yes');
  });
});
