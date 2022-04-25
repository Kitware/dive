import { computed, Ref } from '@vue/composition-api';
import { cloneDeep } from 'lodash';
import BaseFilterControls, { AnnotationWithContext, FilterControlsParams } from './BaseFilterControls';
import type Group from './Group';
import type GroupStore from './GroupStore';
import type Track from './track';

interface TrackFilterControlsParams extends FilterControlsParams<Track> {
  groupStore: GroupStore;
  groupFilterControls: BaseFilterControls<Group>;
}

export default class TrackFilterControls extends BaseFilterControls<Track> {
  filteredAnnotations: Ref<AnnotationWithContext<Track>[]>;

  constructor(params: TrackFilterControlsParams) {
    super(params);

    /**
     * Override filtered track annotations to include logic
     * for filtering based on group membership as well
     */
    this.filteredAnnotations = computed(() => {
      const checkedSet = new Set(this.checkedTypes.value);
      const confidenceFiltersVal = cloneDeep(this.confidenceFilters.value);
      const resultsArr: AnnotationWithContext<Track>[] = [];
      params.store.sorted.value.forEach((annotation) => {
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
}
