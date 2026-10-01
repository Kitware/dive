import { defineComponent, h, ref } from 'vue';
import { shallowMount } from '@vue/test-utils';
import Track from '../../track';
import TrackItem from './TrackItem.vue';

const state = vi.hoisted(() => ({
  range: null as [number, number] | null,
  seekSlot: vi.fn(),
}));

vi.mock('../../use/useVuetify', () => ({
  default: () => ({ theme: { themes: { dark: { accentBackground: '#000' } } } }),
}));

vi.mock('../../provides', () => ({
  useTime: () => ({ frame: ref(0) }),
  useCameraStore: () => ({}),
  useSelectedCamera: () => ref('EO'),
  useTrackTimeline: () => ({ range: () => state.range, seekSlot: state.seekSlot }),
}));

function mountItem() {
  const features: ConstructorParameters<typeof Track>[1]['features'] = [];
  features[2] = { frame: 2, bounds: [0, 0, 1, 1], keyframe: true };
  features[3] = { frame: 3, bounds: [0, 0, 1, 1], keyframe: true };
  const track = new Track(1, {
    begin: 2, end: 3, confidencePairs: [['fish', 0.9]], features,
  });
  const onSeek = vi.fn();
  const Host = defineComponent({
    setup: () => () => h(TrackItem, {
      props: {
        compact: true,
        trackType: 'fish',
        displayPairIndex: 0,
        track,
        inputValue: true,
        selected: false,
        secondarySelected: false,
        editing: false,
        color: '#fff',
      },
      on: { seek: onSeek },
    }),
  });
  const wrapper = shallowMount(Host, { stubs: { TrackItem: false } });
  return { row: wrapper.findComponent({ name: 'BottomBarTrackItemView' }), onSeek };
}

beforeEach(() => {
  state.range = null;
  state.seekSlot.mockReset();
});

it('shows and seeks to timeline slots when the track sits on an aligned timeline', () => {
  state.range = [1, 2];
  const { row, onSeek } = mountItem();
  expect(row.props('displayBegin')).toBe(1);
  expect(row.props('displayEnd')).toBe(2);
  (row.props('seekBegin') as () => void)();
  (row.props('seekEnd') as () => void)();
  expect(state.seekSlot.mock.calls).toEqual([[1], [2]]);
  expect(onSeek).not.toHaveBeenCalled();
});

it('shows and seeks to stored frames without an aligned timeline', () => {
  const { row, onSeek } = mountItem();
  expect(row.props('displayBegin')).toBe(2);
  expect(row.props('displayEnd')).toBe(3);
  (row.props('seekBegin') as () => void)();
  expect(onSeek).toHaveBeenCalledWith(2);
  expect(state.seekSlot).not.toHaveBeenCalled();
});
