import { computed, ref, Ref } from '@vue/composition-api';
import { TrackWithContext } from './useTrackFilters';
import { TrackId } from '../track';
/* Maintain references to the selected Track, selected detection,
 * editing state, etc.
 */
export default function useTrackSelectionControls(
  { filteredTracks }: {filteredTracks: Readonly<Ref<readonly TrackWithContext[]>>},
) {
  // the currently selected Track
  const selectedTrackId = ref(null as TrackId | null);
  // boolean whether or not selectedTrackId is also being edited.
  const editingTrack = ref(false);

  const tracks = computed(() => filteredTracks.value.map((filtered) => filtered.track));

  function selectTrack(trackId: TrackId | null, edit = false) {
    selectedTrackId.value = trackId;
    editingTrack.value = trackId !== null && edit;
  }
  /* default to index + 1
   * call with -1 to select previous, or pass any other delta
   */
  function selectNextTrack(delta = 1): TrackId | null {
    if (tracks.value.length > 0) {
      if (selectedTrackId.value === null) {
        // if no track is selected, return the first trackId
        return tracks.value[0].trackId;
      }
      // return the trackId by the delta offset if it exists
      const index = tracks.value.findIndex((t) => t.trackId === selectedTrackId.value);
      const newIndex = index + delta;
      if (newIndex >= 0 && newIndex < tracks.value.length) {
        // if we are not at the end
        return tracks.value[newIndex].trackId;
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
