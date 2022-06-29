import {
  ref, computed, Ref, watch,
} from '@vue/composition-api';
import type { AnnotationId } from './BaseAnnotation';
import type Group from './Group';
import type Track from './track';
import { updateSubset } from './utils';

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

export interface FilterControlsParams<T extends Track | Group> {
  sorted: Ref<T[]>;
  markChangesPending: () => void;
  remove: (id: AnnotationId) => void;
}

export type TrackWithContext = AnnotationWithContext<Track>;
export type GroupWithContext = AnnotationWithContext<Group>;

/* Provide annotation filtering controls on annotations loaded from store. */
export default abstract class BaseFilterControls<T extends Track | Group> {
  /* Annotation IDs explicitly checked "ON" by the user */
  checkedIDs: Ref<AnnotationId[]>;

  /* The confidence threshold to test confidecePairs against */
  confidenceFilters: Ref<Record<string, number>>;

  /* The types informed by meta configuration */
  private defaultTypes: Ref<string[]>;

  /* Collect all known types from confidence pairs */
  allTypes: Ref<string[]>;

  /* Types currently assigned to at least one annotation */
  usedTypes: Ref<string[]>;

  /* Categorical types checked "ON" by the user */
  checkedTypes: Ref<string[]>;

  /* Annotation IDs filtered by type and confidence threshold */
  filteredAnnotations: Ref<AnnotationWithContext<T>[]>;

  /* AnnotationIDs further filtered by individual checkedIds */
  enabledAnnotations: Ref<AnnotationWithContext<T>[]>;

  /* MarkChangesPending is called when meta config default types are modified  */
  private markChangesPending: () => void;

  /* Hold a reference to the annotationStore */
  sorted: Readonly<Ref<T[]>>;

  remove: (id: AnnotationId) => void;

  constructor(params: FilterControlsParams<T>) {
    this.checkedIDs = ref(params.sorted.value.map((t) => t.id));

    this.confidenceFilters = ref({ default: DefaultConfidence } as Record<string, number>);

    this.defaultTypes = ref([]);

    this.sorted = params.sorted;

    this.remove = params.remove;

    this.markChangesPending = params.markChangesPending;

    this.allTypes = computed(() => {
      const typeSet = new Set<string>();
      this.sorted.value.forEach((annotation) => {
        annotation.confidencePairs.forEach(([name]) => {
          typeSet.add(name);
        });
      });
      this.defaultTypes.value.forEach((type) => {
        typeSet.add(type);
      });
      return Array.from(typeSet);
    });

    this.usedTypes = computed(() => {
      const typeSet = new Set<string>();
      this.sorted.value.forEach((annotation) => {
        annotation.confidencePairs.forEach(([name]) => {
          typeSet.add(name);
        });
      });
      return Array.from(typeSet);
    });

    this.checkedTypes = ref(Array.from(this.allTypes.value));

    this.filteredAnnotations = ref([]);

    this.enabledAnnotations = computed(() => {
      const checkedSet = new Set(this.checkedIDs.value);
      return this.filteredAnnotations.value
        .filter((filtered) => checkedSet.has(filtered.annotation.id));
    });

    // because vue watchers don't behave properly, and it's better to not have
    // checkedIDs be a union null | array type
    let oldCheckedIds: AnnotationId[] = [];
    /* When the list of types (or checked IDs) changes
    * add the new enabled types to the set and remove old ones */
    watch(params.sorted, (newval) => {
      const IDs = newval.map((t) => t.id);
      const newArr = updateSubset(oldCheckedIds, IDs, this.checkedIDs.value);
      if (newArr !== null) {
        oldCheckedIds = IDs;
        this.checkedIDs.value = newArr;
      }
    });

    let oldCheckedtypes: string[] = [];
    watch(this.usedTypes, (newval) => {
      const newArr = updateSubset(oldCheckedtypes, newval, this.checkedTypes.value);
      if (newArr !== null) {
        oldCheckedtypes = Array.from(newval);
        this.checkedTypes.value = newArr;
      }
    });
  }


  importTypes(types: string[], userInteraction = true) {
    types.forEach((type) => {
      if (!this.defaultTypes.value.includes(type)) {
        this.defaultTypes.value.push(type);
      }
    });
    if (userInteraction) {
      this.markChangesPending();
    }
  }

  deleteType(type: string) {
    if (this.defaultTypes.value.includes(type)) {
      this.defaultTypes.value.splice(this.defaultTypes.value.indexOf(type), 1);
    }
    delete this.confidenceFilters.value[type];
    this.markChangesPending();
  }

  setConfidenceFilters(val?: Record<string, number>) {
    if (val) {
      this.confidenceFilters.value = val;
    }
  }

  updateTypeName({ currentType, newType }: { currentType: string; newType: string }) {
    //Go through the entire list and replace the oldType with the new Type
    this.sorted.value.forEach((annotation) => {
      for (let i = 0; i < annotation.confidencePairs.length; i += 1) {
        const [name, confidenceVal] = annotation.confidencePairs[i];
        if (name === currentType) {
          annotation.setType(newType, confidenceVal, currentType);
          break;
        }
      }
    });
    if (!(newType in this.confidenceFilters.value) && currentType in this.confidenceFilters.value) {
      this.setConfidenceFilters({
        ...this.confidenceFilters.value,
        [newType]: this.confidenceFilters.value[currentType],
      });
    }
    this.deleteType(currentType);
  }

  removeTypeAnnotations(types: string[]) {
    this.filteredAnnotations.value.forEach((filtered) => {
      const filteredType = filtered.annotation.getType(filtered.context.confidencePairIndex);
      if (filteredType && types.includes(filteredType[0])) {
        //Remove the type from the annotation if multiple types exist
        const newConfidencePairs = filtered.annotation.removeTypes(types);
        if (newConfidencePairs.length === 0) {
          this.remove(filtered.annotation.id);
        }
      }
    });
  }

  updateCheckedTypes(types: string[]) {
    this.checkedTypes.value = types;
  }

  updateCheckedId(id: AnnotationId, value: boolean) {
    if (value) {
      this.checkedIDs.value.push(id);
    } else {
      const i = this.checkedIDs.value.indexOf(id);
      this.checkedIDs.value.splice(i, 1);
    }
  }
}
