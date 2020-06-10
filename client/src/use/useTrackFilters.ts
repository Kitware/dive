import {
  ref, computed, Ref, watch,
} from '@vue/composition-api';
import Track, { TrackId } from '@/lib/track';
import { updateSubset } from '@/lib/utils';

interface UseTrackFilterParams {
  trackMap: Map<TrackId, Track>;
  sortedTrackIds: Readonly<Ref<readonly TrackId[]>>;
}

/* Provide track filtering controls on tracks loaded from useTrackStore. */
export default function useFilteredTracks(
  { trackMap, sortedTrackIds }: UseTrackFilterParams,
) {
  /* Track IDs explicitly checked "ON" by the user */
  const checkedTrackIds = ref(Array.from(sortedTrackIds.value));
  // because vue watchers don't behave properly, and it's better to not have
  // checkedTrackIds be a union null | array type
  let checkedTrackIdsInitialized = false;
  /* The confidence threshold to test confidecePairs against */
  const confidenceThreshold = ref(0.5);

  /* Collect all known types from confidence pairs */
  const allTypes = computed(() => {
    const typeSet = new Set<string>();
    sortedTrackIds.value.forEach((trackId) => {
      const track = trackMap.get(trackId);
      if (track === undefined) {
        throw new Error(`Accessed missing track ${trackId}`);
      }
      track.confidencePairs.forEach(([name]) => {
        typeSet.add(name);
      });
    });
    return Array.from(typeSet);
  });

  /* Categorical types checked "ON" by the user */
  const checkedTypes = ref(Array.from(allTypes.value));
  // see above
  let checkedTypesInitialized = false;

  /* track IDs filtered by type and confidence threshold */
  const filteredTrackIds = computed(() => {
    const checkedSet = new Set(checkedTypes.value);
    const confidenceThresh = confidenceThreshold.value;
    return sortedTrackIds.value.filter((trackId) => {
      const track = trackMap.get(trackId);
      if (track === undefined) {
        throw new Error(`Accessed missing track ${trackId}`);
      }
      const confidencePairsAboveThreshold = track.confidencePairs
        .some(([confkey, confval]) => (
          confval >= confidenceThresh && checkedSet.has(confkey)
        ));
      return (
        /* include tracks where at least 1 confidence pair is above
         * the threshold and part of the checked type set */
        confidencePairsAboveThreshold
        /* include tracks with no confidence pairs */
        || track.confidencePairs.length === 0
      );
    });
  });

  const enabledTrackIds = computed(() => {
    const checkedSet = new Set(checkedTrackIds.value);
    return filteredTrackIds.value.filter((trackId) => checkedSet.has(trackId));
  });

  /* When the list of types (or checked IDs) changes
   * add the new enabled types to the set and remove old ones */
  watch(sortedTrackIds, (newval, oldval) => {
    const newArr = updateSubset(oldval, newval, checkedTrackIds.value);
    if (!checkedTrackIdsInitialized && newval.length) {
      checkedTrackIds.value = Array.from(newval);
      checkedTrackIdsInitialized = true;
    }
    if (newArr !== null) {
      checkedTrackIds.value = newArr;
    }
  });
  watch(allTypes, (newval, oldval) => {
    const newArr = updateSubset(oldval, newval, checkedTypes.value);
    if (!checkedTypesInitialized && newval.length) {
      checkedTypes.value = Array.from(newval);
      checkedTypesInitialized = true;
    }
    if (newArr !== null) {
      checkedTypes.value = newArr;
    }
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
