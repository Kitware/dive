import { computed, Ref, ref } from '@vue/composition-api';
import { cloneDeep } from 'lodash';
import { AnnotationId } from './BaseAnnotation';
import BaseFilterControls, { AnnotationWithContext, FilterControlsParams } from './BaseFilterControls';
import type Group from './Group';
import type Track from './track';
import { AttributeTrackFilter, filterByTrackId, userDefinedVals } from './AttributeTrackFilterControls';

interface TrackFilterControlsParams extends FilterControlsParams<Track> {
  lookupGroups: (annotationId: AnnotationId) => Group[];
  getTrack: (annotationId: AnnotationId, camera?: string) => Track;
  groupFilterControls: BaseFilterControls<Group>;
}

export default class TrackFilterControls extends BaseFilterControls<Track> {
  filteredAnnotations: Ref<AnnotationWithContext<Track>[]>;

  userDefinedValues: Ref<userDefinedVals[]>;

  attributeFilters: Ref<AttributeTrackFilter[]>;

  enabledFilters: Ref<boolean[]>;

  constructor(params: TrackFilterControlsParams) {
    super(params);

    this.attributeFilters = ref([]);

    this.userDefinedValues = ref([]);

    this.enabledFilters = ref([]);

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
          let addValue = true;
          if (this.attributeFilters.value.length > 0 && params.getTrack !== undefined) {
            addValue = filterByTrackId(
              annotation.id,
              params.getTrack as (trackId: AnnotationId) => Track,
              this.attributeFilters.value,
              this.userDefinedValues.value,
              this.enabledFilters.value,
            );
          }
          if (addValue) {
            resultsIds.add(annotation.id);
            resultsArr.push({
              annotation,
              context: {
                confidencePairIndex,
              },
            });
          }
        }
      });
      return resultsArr;
    });
  }

  loadTrackAttributesFilter(trackAttributesFilter: Readonly<AttributeTrackFilter[]>) {
    this.attributeFilters.value = [];
    this.userDefinedValues.value = [];
    this.enabledFilters.value = [];
    trackAttributesFilter.forEach((element) => {
      this.attributeFilters.value.push(element);
      this.userDefinedValues.value.push(element.filter.userDefined ? element.filter.val : null);
      this.enabledFilters.value.push(element.enabled);
    });
  }

  setUserDefinedValue(index: number, val: number) {
    if (index < this.userDefinedValues.value.length) {
      this.userDefinedValues.value.splice(index, 1, val);
    }
  }

  setEnabled(index: number, val: boolean) {
    if (index < this.enabledFilters.value.length) {
      this.enabledFilters.value.splice(index, 1, val);
    }
  }
}
