import {
  ref, computed, Ref, watch,
} from '@vue/composition-api';
import { TrackId } from '@/use/useTrackStore';
import { updateSubset } from '@/lib/utils';
import Track from '@/lib/track';

interface UseTrackFilterParams {
  trackMap: Map<TrackId, Track>,
  sortedTrackIds: Readonly<Ref<readonly TrackId[]>>,
}

/* Provide track filtering controls on tracks loaded from useTrackStore. */
export default function useFilteredTracks({ trackMap, sortedTrackIds }: UseTrackFilterParams) {
  /* Track IDs explicitly checked "ON" by the user */
  const checkedTrackIds = ref(Array.from(sortedTrackIds.value));
  /* The confidence threshold to test confidecePairs against */
  const confidenceThreshold = ref(0.5);

  /* Collect all known types from confidence pairs */
  const allTypes = computed(() => {
    const typeSet = new Set<string>();
    sortedTrackIds.value.forEach((trackId) => {
      const track = trackMap.get(trackId);
      track!.confidencePairs.value.forEach(([name, _]) => {
        typeSet.add(name);
      });
    });
    return Array.from(typeSet);
  });

  /* Categorical types checked "ON" by the user */
  const checkedTypes = ref(Array.from(allTypes.value));

  /* track IDs filtered by type and confidence threshold */
  const filteredTrackIds = computed(() => {
    console.error('computed filteredTracks');
    const checkedSet = new Set(checkedTypes.value);
    return sortedTrackIds.value.filter((trackId) => {
      const track = trackMap.get(trackId);
      const confidencePairsAboveThreshold = track!.confidencePairs.value
        .some(([confkey, confval]) => (
          confval >= confidenceThreshold.value && checkedSet.has(confkey)
        ));
      return (
        /* include tracks where at least 1 confidence pair is above
         * the threshold and part of the checked type set */
        confidencePairsAboveThreshold
        /* include tracks with no confidence pairs */
        || track!.confidencePairs.value.length === 0
      );
    });
  });

  const enabledTrackIds = computed(() => {
    const checkedSet = new Set(checkedTrackIds.value);
    return filteredTrackIds.value.filter((trackId) => checkedSet.has(trackId));
  });

  /* When the list of types (or checked IDs) changes
   * add the new enabled types to the set and remove old ones */
  watch(sortedTrackIds, (newval) => {
    checkedTrackIds.value = updateSubset(checkedTrackIds.value, newval);
  });
  watch(allTypes, (newval) => {
    console.error('watchalltypes');
    checkedTypes.value = updateSubset(checkedTypes.value, newval);
  });

  return {
    checkedTrackIds,
    checkedTypes,
    confidenceThreshold,
    allTypes,
    filteredTrackIds,
    enabledTrackIds,
  };
}
