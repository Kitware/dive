import {
  ref, computed, Ref, watch,
} from '@vue/composition-api';
import Track, { TrackId } from '../track';
import { updateSubset } from '../utils';

/**
 * TrackWithContext wraps a track with additional information
 * such as why the track was included or returned by a system
 * or function.
 */
export interface TrackWithContext {
  track: Readonly<Track>;
  context: {
    // confidencePair index within track that makes this track a positive filter result
    confidencePairIndex: number;
  };
}

/* Provide track filtering controls on tracks loaded from useTrackStore. */
export default function useFilteredTracks(
  { sortedTracks, removeTrack, markChangesPending }:
  {
    sortedTracks: Readonly<Ref<readonly Track[]>>;
    removeTrack: (trackId: TrackId) => void;
    markChangesPending: () => void;
  },
) {
  /* Track IDs explicitly checked "ON" by the user */
  const checkedTrackIds = ref(sortedTracks.value.map((t) => t.trackId));
  /* The confidence threshold to test confidecePairs against */
  const confidenceFilters = ref({ default: 0.1 } as Record<string, number>);
  const defaultTypes: Ref<string[]> = ref([]);

  /**
   * TODO: update
   * Short-term representation of a global threshold before individual
   * type thresholds are implemented
   */
  const defaultConfidenceThreshold = computed({
    get: () => confidenceFilters.value.default,
    set: (val: number) => {
      confidenceFilters.value.default = val;
    },
  });

  /* Collect all known types from confidence pairs */
  const allTypes = computed(() => {
    const typeSet = new Set<string>();
    sortedTracks.value.forEach((track) => {
      track.confidencePairs.forEach(([name]) => {
        typeSet.add(name);
      });
    });
    defaultTypes.value.forEach((type) => {
      typeSet.add(type);
    });
    return Array.from(typeSet);
  });

  const usedTypes = computed(() => {
    const typeSet = new Set<string>();
    sortedTracks.value.forEach((track) => {
      track.confidencePairs.forEach(([name]) => {
        typeSet.add(name);
      });
    });
    return Array.from(typeSet);
  });
  /* Categorical types checked "ON" by the user */
  const checkedTypes = ref(Array.from(allTypes.value));

  /* track IDs filtered by type and confidence threshold */
  const filteredTracks = computed(() => {
    const checkedSet = new Set(checkedTypes.value);
    const confidenceThresh = defaultConfidenceThreshold.value;
    const resultsArr: TrackWithContext[] = [];
    sortedTracks.value.forEach((track) => {
      const confidencePairIndex = track.confidencePairs
        .findIndex(([confkey, confval]) => confval >= confidenceThresh && checkedSet.has(confkey));
        /* include tracks where at least 1 confidence pair is above
         * the threshold and part of the checked type set */
      if (confidencePairIndex >= 0 || track.confidencePairs.length === 0) {
        resultsArr.push({
          track,
          context: {
            confidencePairIndex,
          },
        });
      }
    });
    return resultsArr;
  });

  const enabledTracks = computed(() => {
    const checkedSet = new Set(checkedTrackIds.value);
    return filteredTracks.value.filter((filtered) => checkedSet.has(filtered.track.trackId));
  });

  // because vue watchers don't behave properly, and it's better to not have
  // checkedTrackIds be a union null | array type
  let oldCheckedTrackIds: TrackId[] = [];
  /* When the list of types (or checked IDs) changes
   * add the new enabled types to the set and remove old ones */
  watch(sortedTracks, (newval) => {
    const IDs = newval.map((t) => t.trackId);
    const newArr = updateSubset(oldCheckedTrackIds, IDs, checkedTrackIds.value);
    if (newArr !== null) {
      oldCheckedTrackIds = IDs;
      checkedTrackIds.value = newArr;
    }
  });

  let oldCheckedtypes: string[] = [];
  watch(usedTypes, (newval) => {
    const newArr = updateSubset(oldCheckedtypes, newval, checkedTypes.value);
    if (newArr !== null) {
      oldCheckedtypes = Array.from(newval);
      checkedTypes.value = newArr;
    }
  });

  function importTypes(types: string[], userInteraction = true) {
    types.forEach((type) => {
      if (!defaultTypes.value.includes(type)) {
        defaultTypes.value.push(type);
      }
    });
    if (userInteraction) {
      markChangesPending();
    }
  }
  function deleteType(type: string) {
    if (defaultTypes.value.includes(type)) {
      defaultTypes.value.splice(defaultTypes.value.indexOf(type), 1);
    }
    markChangesPending();
  }
  function updateTypeName({ currentType, newType }: {currentType: string; newType: string}) {
    //Go through the entire list and replace the oldType with the new Type
    sortedTracks.value.forEach((track) => {
      track.confidencePairs.forEach(([name, confidenceVal]) => {
        if (name === currentType) {
          track.setType(newType, confidenceVal);
        }
      });
    });
    if (defaultTypes.value.includes(currentType)) {
      defaultTypes.value[defaultTypes.value.indexOf(currentType)] = newType;
    }
    markChangesPending();
  }

  function removeTypeTracks(types: string[]) {
    filteredTracks.value.forEach((filtered) => {
      const filteredType = filtered.track.getType(filtered.context.confidencePairIndex);
      if (filteredType && types.includes(filteredType[0])) {
        //Remove the type from the track if multiple types exist
        const newConfidencePairs = filtered.track.removeTypes(types);
        if (newConfidencePairs.length === 0) {
          removeTrack(filtered.track.trackId);
        }
      }
    });
  }

  function populateConfidenceFilters(val?: Record<string, number>) {
    if (val) {
      confidenceFilters.value = val;
    }
  }

  function updateCheckedTypes(types: string[]) {
    checkedTypes.value = types;
  }

  function updateCheckedTrackId(trackId: TrackId, value: boolean) {
    if (value) {
      checkedTrackIds.value.push(trackId);
    } else {
      const i = checkedTrackIds.value.indexOf(trackId);
      checkedTrackIds.value.splice(i, 1);
    }
  }

  return {
    checkedTrackIds,
    checkedTypes,
    confidenceThreshold: defaultConfidenceThreshold,
    confidenceFilters,
    allTypes,
    usedTypes,
    filteredTracks,
    enabledTracks,
    populateConfidenceFilters,
    updateCheckedTrackId,
    updateCheckedTypes,
    updateTypeName,
    removeTypeTracks,
    importTypes,
    deleteType,
  };
}
