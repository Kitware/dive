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

    tsc.selectNextTrack();
    expect(tsc.selectedTrackId.value).toBe(0);
    tsc.selectNextTrack();
    expect(tsc.selectedTrackId.value).toBe(2);

    tsc.selectNextTrack(-100);
    expect(tsc.selectedTrackId.value).toBeNull();

    tsc.selectNextTrack(100);
    expect(tsc.selectedTrackId.value).toBe(0);

    tsc.selectNextTrack(100);
    expect(tsc.selectedTrackId.value).toBeNull();
  });
});
