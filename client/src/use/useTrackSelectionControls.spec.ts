/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi, { computed, ref } from '@vue/composition-api';
import Track from '../track';
import useTrackSelectionControls from './useTrackSelectionControls';

Vue.use(CompositionApi);

const filteredTracks = computed(() => ([
  {
    track: new Track(0, {}),
    context: {
      confidencePairIndex: 0,
    },
  },
  {
    track: new Track(2, {}),
    context: {
      confidencePairIndex: 0,
    },
  },
  {
    track: new Track(200, {}),
    context: {
      confidencePairIndex: 0,
    },
  },
  {
    track: new Track(1000, {}),
    context: {
      confidencePairIndex: 0,
    },
  },
]));

describe('useTrackSelectionControls', () => {
  it('can select individual tracks', () => {
    const tsc = useTrackSelectionControls({ filteredTracks, readonlyState: ref(false) });
    expect(tsc.selectedTrackId.value).toBeNull();

    tsc.selectTrack(2);
    expect(tsc.selectedTrackId.value).toBe(2);
    tsc.selectTrack(2, true);
    expect(tsc.editingTrack.value).toBe(true);

    // this module doesn't verify that the selected
    // track is a valid track ID
    tsc.selectTrack(NaN, true);
    expect(tsc.selectedTrackId.value).toBeNaN();

    tsc.selectTrack(null, false);
    expect(tsc.selectedTrackId.value).toBeNull();
    expect(tsc.editingTrack.value).toBe(false);
  });

  it('can select next or previous track', () => {
    const tsc = useTrackSelectionControls({ filteredTracks, readonlyState: ref(false) });

    expect(tsc.selectNextTrack()).toBe(0);

    tsc.selectTrack(tsc.selectNextTrack());
    expect(tsc.selectNextTrack()).toBe(2);

    expect(tsc.selectNextTrack(-100)).toBeNull();
    tsc.selectTrack(tsc.selectNextTrack(-100));

    expect(tsc.selectNextTrack(100)).toBe(0);
    tsc.selectTrack(tsc.selectNextTrack(100));

    expect(tsc.selectNextTrack(100)).toBeNull();
  });
});
