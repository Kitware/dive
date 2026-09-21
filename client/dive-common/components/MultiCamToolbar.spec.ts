import {
  defineComponent, h, nextTick, ref, Ref,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
import Track from 'vue-media-annotator/track';
import MultiCamToolbar from './MultiCamToolbar.vue';

const state = vi.hoisted(() => ({
  selectedCamera: null as unknown as Ref<string>,
  tracks: new Map<string, Track>(),
  removeTrack: vi.fn(),
}));

vi.mock('vue-media-annotator/provides', () => ({
  useSelectedCamera: () => state.selectedCamera,
  useSelectedTrackId: () => ref(1),
  useTime: () => ({ frame: ref(10) }),
  useTrackFilters: () => ({ enabledAnnotations: ref([1]) }),
  useEditingMode: () => ref(false),
  useHandler: () => ({ removeTrack: state.removeTrack, trackSelect: vi.fn() }),
  useCameraStore: () => ({
    orderedCameraNames: () => [...state.tracks.keys()],
    camMap: ref(new Map([...state.tracks].map(([camera, track]) => [camera, {
      trackStore: { getPossible: () => track, get: () => track },
    }]))),
    getTrackAll: () => [...state.tracks.values()],
  }),
}));

const Slots = defineComponent({
  setup: (_, { slots }) => () => h('div', [
    slots.activator?.({ on: {}, attrs: {} }), slots.default?.(),
  ]),
});

function mountToolbar(expanded: boolean) {
  localStorage.setItem('multiCamToolbar.expanded', String(expanded));
  const Host = defineComponent({ setup: () => () => h(MultiCamToolbar) });
  return shallowMount(Host, {
    directives: { mousetrap: () => undefined },
    stubs: {
      MultiCamToolbar: false,
      OutlinedLabeledGroup: Slots,
      'v-tooltip': Slots,
      'v-menu': Slots,
    },
  });
}

function makeTrack(frames: number[]) {
  const track = new Track(1, {});
  frames.forEach((frame) => track.setFeature({
    frame, bounds: [0, 0, 10, 10], keyframe: true,
  }));
  return track;
}

beforeEach(() => {
  state.selectedCamera = ref('left');
  state.tracks = new Map([
    ['left', makeTrack([10])],
    ['right', makeTrack([10, 20])],
  ]);
  state.removeTrack.mockReset();
});

describe.each([true, false])('MultiCamToolbar expanded=%s', (expanded) => {
  it('deduplicates deletion for a single state and updates when switching cameras', async () => {
    const wrapper = mountToolbar(expanded);
    expect(wrapper.text()).not.toContain('mdi-star-minus');
    expect(wrapper.text()).toContain('mdi-delete');
    expect(wrapper.text()).toContain('Delete detection from current camera');
    expect(wrapper.text()).not.toContain('Delete track from current camera');
    state.selectedCamera.value = 'right';
    await nextTick();
    expect(wrapper.text()).toContain('mdi-star-minus');
    expect(wrapper.text()).toContain('Delete track from current camera');
    state.selectedCamera.value = 'left';
    await nextTick();
    expect(wrapper.text()).not.toContain('mdi-star-minus');
    const button = wrapper.findAll('v-btn')
      .wrappers.find((item) => item.text().includes('mdi-delete'));
    expect(button).toBeDefined();
    await button!.trigger('click');
    expect(state.removeTrack).toHaveBeenCalledWith([1], true, 'left');
    wrapper.destroy();
  });

  it('restores frame deletion when a second state is added', async () => {
    const wrapper = mountToolbar(expanded);
    state.tracks.get('left')!.setFeature({
      frame: 20, bounds: [0, 0, 10, 10], keyframe: true,
    });
    await nextTick();
    expect(wrapper.text()).toContain('mdi-star-minus');
    expect(wrapper.text()).toContain('Delete track from current camera');
    wrapper.destroy();
  });
});
