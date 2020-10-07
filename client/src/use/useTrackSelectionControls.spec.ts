/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi, { computed } from '@vue/composition-api';
import Track from '../track';
import useTrackSelectionControls from './useTrackSelectionControls';

Vue.use(CompositionApi);

const tracks = computed(() => ([
  new Track(0, {}),
  new Track(2, {}),
  new Track(200, {}),
  new Track(1000, {}),
]));

describe('useTrackSelectionControls', () => {
  it('can select individual tracks', () => {
    const tsc = useTrackSelectionControls({ tracks });
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
    const tsc = useTrackSelectionControls({ tracks });

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
