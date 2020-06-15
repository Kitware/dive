/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi, { ref } from '@vue/composition-api';
import useTrackSelectionControls from '@/use/useTrackSelectionControls';

Vue.use(CompositionApi);


describe('useTrackSelectionControls', () => {
  it('can select individual tracks', () => {
    const trackIds = ref([0, 2, 200, 1000]);
    const tsc = useTrackSelectionControls({ trackIds });
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
    const trackIds = ref([0, 2, 200, 1000]);
    const tsc = useTrackSelectionControls({ trackIds });

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
