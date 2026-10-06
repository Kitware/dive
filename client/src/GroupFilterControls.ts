import { computed, ref, Ref } from 'vue';
import { cloneDeep } from 'lodash';
import { AnnotationId } from './BaseAnnotation';
import BaseFilterControls, { AnnotationWithContext, FilterControlsParams } from './BaseFilterControls';
import type Group from './Group';

export interface GroupFilterControlsParams extends FilterControlsParams<Group> {
  setGroupType: (
    id: AnnotationId,
    newType: string,
    confidenceVal?: number,
    currentType?: string,
  ) => void;
}

export default class GroupFilterControls extends BaseFilterControls<Group> {
  filteredAnnotations: Ref<AnnotationWithContext<Group>[]>;

  private setGroupType: GroupFilterControlsParams['setGroupType'];

  constructor(params: GroupFilterControlsParams) {
    super(params);

    this.setGroupType = params.setGroupType;

    /**
     * Override default confidence filters.  There is no UI to adjust this,
     * so filter nothing by default
     */
    this.confidenceFilters = ref({ default: 0 });

    /**
     * Override filtered track annotations to include logic
     * for filtering based on group membership as well
     */
    this.filteredAnnotations = computed(() => {
      const checkedSet = new Set(this.checkedTypes.value);
      const confidenceFiltersVal = cloneDeep(this.confidenceFilters.value);
      const resultsArr: AnnotationWithContext<Group>[] = [];
      params.sorted.value.forEach((annotation) => {
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
  }

  updateTypeName({ currentType, newType }: { currentType: string; newType: string }) {
    this.sorted.value.forEach((annotation) => {
      for (let i = 0; i < annotation.confidencePairs.length; i += 1) {
        const [name, confidenceVal] = annotation.confidencePairs[i];
        if (name === currentType) {
          this.setGroupType(annotation.id, newType, confidenceVal, currentType);
          break;
        }
      }
    });
    this.carryConfidenceFilter(currentType, newType);
    this.deleteType(currentType);
  }
}
