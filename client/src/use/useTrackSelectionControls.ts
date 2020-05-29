import { ref, Ref } from '@vue/composition-api';
import Track, { TrackId } from '@/lib/track';

interface UseTrackSelectionControlsParams {
  trackIds: Readonly<Ref<readonly TrackId[]>>;
  removeTrack: (trackId: TrackId) => void;
}

/* Maintain references to the selected Track, selected detection,
 * editing state, etc.
 */
export default function useTrackSelectionControls(
  { trackIds, removeTrack }: UseTrackSelectionControlsParams,
) {
  // the currently selected Track
  const selectedTrackId = ref(null as TrackId | null);
  // boolean whether or not selectedTrackId is also being edited.
  const editingTrack = ref(false);

  /* default to index + 1
   * call with -1 to select previous, or pass any other delta
   */
  function selectNextTrack(delta = 1) {
    if (trackIds.value.length > 0) {
      if (selectedTrackId.value === null) {
        // if no track is selected, select the first one
        [selectedTrackId.value] = trackIds.value;
      } else {
        // else select the next, and get stuck at the end
        const index = trackIds.value.indexOf(selectedTrackId.value);
        const newIndex = index + delta;
        if (newIndex >= 0 && newIndex < trackIds.value.length) {
          selectedTrackId.value = trackIds.value[newIndex];
        }
      }
    }
  }

  // TODO p1: refactor to viewer
  function wrapRemoveTrack(trackId: TrackId) {
    if (selectedTrackId.value === trackId) {
      selectedTrackId.value = null;
    }
    removeTrack(trackId);
  }

  return {
    selectedTrackId,
    editingTrack,
    selectNextTrack,
    removeTrack: wrapRemoveTrack,
  };
}
