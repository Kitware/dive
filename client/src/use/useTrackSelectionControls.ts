import { ref, Ref } from '@vue/composition-api';
import { TrackId } from '@/lib/track';

interface UseTrackSelectionControlsParams {
  trackIds: Readonly<Ref<readonly TrackId[]>>;
}

/* Maintain references to the selected Track, selected detection,
 * editing state, etc.
 */
export default function useTrackSelectionControls(
  { trackIds }: UseTrackSelectionControlsParams,
) {
  // the currently selected Track
  const selectedTrackId = ref(null as TrackId | null);
  // boolean whether or not selectedTrackId is also being edited.
  const editingTrack = ref(false);

  function selectTrack(trackId: TrackId | null, edit = false) {
    selectedTrackId.value = trackId;
    editingTrack.value = edit;
  }
  /* default to index + 1
   * call with -1 to select previous, or pass any other delta
   */
  function selectNextTrack(delta = 1): TrackId | null {
    if (trackIds.value.length > 0) {
      if (selectedTrackId.value === null) {
        // if no track is selected, select the first one
        const [first] = trackIds.value;
        return first;
      }
      // else select the next, and loop back to beginnng
      const index = trackIds.value.indexOf(selectedTrackId.value);
      const newIndex = index + delta;
      if (newIndex >= 0 && newIndex < trackIds.value.length) {
        // if we are not at the end
        return trackIds.value[newIndex];
      }
    }
    //Return null if no other conditions are met
    return null;
  }
  return {
    selectedTrackId,
    editingTrack,
    selectNextTrack,
    selectTrack,
  };
}
