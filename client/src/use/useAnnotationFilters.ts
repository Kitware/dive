import {
  ref, computed, Ref, watch,
} from '@vue/composition-api';
import { cloneDeep } from 'lodash';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import type BaseAnnotationStore from '../BaseAnnotationStore';
import type Group from '../Group';
import type Track from '../track';
import { updateSubset } from '../utils';

export const DefaultConfidence = 0.1;
/**
 * AnnotationWithContext wraps an annotation with additional information
 * such as why the annotation was included or returned by a system
 * or function.
 */
export interface AnnotationWithContext<T extends Track | Group> {
  annotation: Readonly<OneOf<T, [Track, Group]>>;
  context: {
    // confidencePair index within annotation that makes this annotation a positive filter result
    confidencePairIndex: number;
  };
}

export type TrackWithContext = AnnotationWithContext<Track>;
export type GroupWithContext = AnnotationWithContext<Group>;

/* Provide annotation filtering controls on annotations loaded from store. */
export default function useFilteredTracks<T extends Track | Group>(
  { store, markChangesPending }: {
    store: BaseAnnotationStore<Track | Group>;
    markChangesPending: () => void;
  },
) {
  /* Annotation IDs explicitly checked "ON" by the user */
  const checkedIDs = ref(store.sorted.value.map((t) => t.id));
  /* The confidence threshold to test confidecePairs against */
  const confidenceFilters = ref({ default: DefaultConfidence } as Record<string, number>);
  const defaultTypes: Ref<string[]> = ref([]);

  /* Collect all known types from confidence pairs */
  const allTypes = computed(() => {
    const typeSet = new Set<string>();
    store.sorted.value.forEach((annotation) => {
      annotation.confidencePairs.forEach(([name]) => {
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
    store.sorted.value.forEach((annotation) => {
      annotation.confidencePairs.forEach(([name]) => {
        typeSet.add(name);
      });
    });
    return Array.from(typeSet);
  });
  /* Categorical types checked "ON" by the user */
  const checkedTypes = ref(Array.from(allTypes.value));

  /* Annotation IDs filtered by type and confidence threshold */
  const filteredAnnotations = computed(() => {
    const checkedSet = new Set(checkedTypes.value);
    const confidenceFiltersVal = cloneDeep(confidenceFilters.value);
    const resultsArr: AnnotationWithContext<Track | Group>[] = [];
    store.sorted.value.forEach((annotation) => {
      const confidencePairIndex = annotation.confidencePairs
        .findIndex(([confkey, confval]) => {
          const confidenceThresh = Math.max(
            confidenceFiltersVal[confkey] || 0,
            confidenceFiltersVal.default,
          );
          return confval >= confidenceThresh && checkedSet.has(confkey);
        });
      /* include annotations where at least 1 confidence pair is above
       * the threshold and part of the checked type set */
      if (confidencePairIndex >= 0 || annotation.confidencePairs.length === 0) {
        resultsArr.push({
          annotation,
          context: {
            confidencePairIndex,
          },
        });
      }
    });
    return resultsArr;
  });

  const enabledAnnotations = computed(() => {
    const checkedSet = new Set(checkedIDs.value);
    return filteredAnnotations.value.filter((filtered) => checkedSet.has(filtered.annotation.id));
  });

  // because vue watchers don't behave properly, and it's better to not have
  // checkedIDs be a union null | array type
  let oldCheckedIds: AnnotationId[] = [];
  /* When the list of types (or checked IDs) changes
   * add the new enabled types to the set and remove old ones */
  watch(store.sorted, (newval) => {
    const IDs = newval.map((t) => t.id);
    const newArr = updateSubset(oldCheckedIds, IDs, checkedIDs.value);
    if (newArr !== null) {
      oldCheckedIds = IDs;
      checkedIDs.value = newArr;
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
    store.sorted.value.forEach((annotation) => {
      for (let i = 0; i < annotation.confidencePairs.length; i += 1) {
        const [name, confidenceVal] = annotation.confidencePairs[i];
        if (name === currentType) {
          annotation.setType(newType, confidenceVal, currentType);
          break;
        }
      }
    });
    if (!(newType in confidenceFilters.value) && currentType in confidenceFilters.value) {
      setConfidenceFilters({
        ...confidenceFilters.value,
        [newType]: confidenceFilters.value[currentType],
      });
    }
    deleteType(currentType);
  }

  function removeTypeAnnotations(types: string[]) {
    filteredAnnotations.value.forEach((filtered) => {
      const filteredType = filtered.annotation.getType(filtered.context.confidencePairIndex);
      if (filteredType && types.includes(filteredType[0])) {
        //Remove the type from the annotation if multiple types exist
        const newConfidencePairs = filtered.annotation.removeTypes(types);
        if (newConfidencePairs.length === 0) {
          store.remove(filtered.annotation.id);
        }
      }
    });
  }

  function updateCheckedTypes(types: string[]) {
    checkedTypes.value = types;
  }

  function updateCheckedId(id: AnnotationId, value: boolean) {
    if (value) {
      checkedIDs.value.push(id);
    } else {
      const i = checkedIDs.value.indexOf(id);
      checkedIDs.value.splice(i, 1);
    }
  }

  return {
    checkedIDs,
    checkedTypes,
    confidenceFilters,
    allTypes,
    usedTypes,
    filteredAnnotations,
    enabledAnnotations,
    setConfidenceFilters,
    updateCheckedId,
    updateCheckedTypes,
    updateTypeName,
    removeTypeAnnotations,
    importTypes,
    deleteType,
  };
}
