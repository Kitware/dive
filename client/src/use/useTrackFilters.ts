import {
  ref, computed, Ref, watch,
} from '@vue/composition-api';
import { cloneDeep } from 'lodash';
import Track, { TrackId } from '../track';
import { updateSubset } from '../utils';
import { getTrackAll } from './useTrackStore';

export const DefaultConfidence = 0.1;
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
  {
    sortedTracks, removeTrack, markChangesPending, camMap,
  }:
  {
    sortedTracks: Readonly<Ref<readonly Track[]>>;
    removeTrack: (trackId: TrackId, disableNotifications?: boolean, cameraName?: string) => void;
    markChangesPending: () => void;
    camMap: Readonly<Map<string, Map<TrackId, Track>>>;
  },
) {
  /* Track IDs explicitly checked "ON" by the user */
  const checkedTrackIds = ref(sortedTracks.value.map((t) => t.trackId));
  /* The confidence threshold to test confidecePairs against */
  const confidenceFilters = ref({ default: DefaultConfidence } as Record<string, number>);
  const defaultTypes: Ref<string[]> = ref([]);

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
    const confidenceFiltersVal = cloneDeep(confidenceFilters.value);
    const resultsArr: TrackWithContext[] = [];
    sortedTracks.value.forEach((track) => {
      const confidencePairIndex = track.confidencePairs
        .findIndex(([confkey, confval]) => {
          const confidenceThresh = Math.max(
            confidenceFiltersVal[confkey] || 0,
            confidenceFiltersVal.default,
          );
          return confval >= confidenceThresh && checkedSet.has(confkey);
        });
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
    delete confidenceFilters.value[type];
    markChangesPending();
  }

  function setConfidenceFilters(val?: Record<string, number>) {
    if (val) {
      confidenceFilters.value = val;
    }
  }

  function updateTypeName({ currentType, newType }: { currentType: string; newType: string }) {
    //Go through the entire list and replace the oldType with the new Type
    sortedTracks.value.forEach((mergedTrack) => {
      const tracks = getTrackAll(camMap, mergedTrack.trackId);
      tracks.forEach((track) => {
        for (let i = 0; i < track.confidencePairs.length; i += 1) {
          const [name, confidenceVal] = track.confidencePairs[i];
          if (name === currentType) {
            track.setType(newType, confidenceVal, currentType);
            break;
          }
        }
      });
    });
    if (!(newType in confidenceFilters.value) && currentType in confidenceFilters.value) {
      setConfidenceFilters({
        ...confidenceFilters.value,
        [newType]: confidenceFilters.value[currentType],
      });
    }
    deleteType(currentType);
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
    confidenceFilters,
    allTypes,
    usedTypes,
    filteredTracks,
    enabledTracks,
    setConfidenceFilters,
    updateCheckedTrackId,
    updateCheckedTypes,
    updateTypeName,
    removeTypeTracks,
    importTypes,
    deleteType,
  };
}
