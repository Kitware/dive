import { computed, Ref } from '@vue/composition-api';
import { cloneDeep } from 'lodash';
import { AnnotationId } from './BaseAnnotation';
import BaseFilterControls, { AnnotationWithContext, FilterControlsParams } from './BaseFilterControls';
import type Group from './Group';
import type Track from './track';

interface TrackFilterControlsParams extends FilterControlsParams<Track> {
  lookupGroups: (annotationId: AnnotationId) => Group[];
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
      const filteredGroupsSet = new Set(params.groupFilterControls.enabledAnnotations.value
        .map((v) => v.annotation.id));
      const confidenceFiltersVal = cloneDeep(this.confidenceFilters.value);
      const resultsArr: AnnotationWithContext<Track>[] = [];
      const resultsIds: Set<AnnotationId> = new Set();
      params.sorted.value.forEach((annotation) => {
        let enabledInGroupFilters = true;
        const groups = params.lookupGroups(annotation.id);
        if (groups.length) {
          /**
           * This track is a member of a group,
           * so check that at least one of its groups is enabled
           */
          enabledInGroupFilters = groups.some((group) => filteredGroupsSet.has(group.id));
        }
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
        if (
          (confidencePairIndex >= 0 || annotation.confidencePairs.length === 0)
          && enabledInGroupFilters && !resultsIds.has(annotation.id)
        ) {
          resultsIds.add(annotation.id);
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
