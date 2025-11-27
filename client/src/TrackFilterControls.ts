import { computed, Ref, ref } from 'vue';
import { cloneDeep } from 'lodash';
import { clientSettings } from 'dive-common/store/settings';
import { AnnotationId } from './BaseAnnotation';
import BaseFilterControls, { AnnotationWithContext, FilterControlsParams } from './BaseFilterControls';
import type Group from './Group';
import type Track from './track';
import { AttributeTrackFilter, trackIdPassesFilter, userDefinedVals } from './AttributeTrackFilterControls';

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
        if (this.timeFilters.value !== null) {
          const [startTime, endTime] = this.timeFilters.value;
          if (annotation.begin > endTime || annotation.end < startTime) {
            return;
          }
        }
        let enabledInGroupFilters = true;
        const groups = params.lookupGroups(annotation.id);
        if (groups.length) {
          /**
           * This track is a member of a group,
           * so check that at least one of its groups is enabled
           */
          enabledInGroupFilters = groups.some((group) => filteredGroupsSet.has(group.id));
        }
        let confidencePairIndex = annotation.confidencePairs
          .findIndex(([confkey, confval]) => {
            const confidenceThresh = Math.max(
              confidenceFiltersVal[confkey] || 0,
              confidenceFiltersVal.default,
            );
            return confval >= confidenceThresh && checkedSet.has(confkey);
          });
        if (clientSettings.typeSettings.preventCascadeTypes) {
          const [confkey, confval] = annotation.confidencePairs[0];
          const confidenceThresh = Math.max(
            confidenceFiltersVal[confkey] || 0,
            confidenceFiltersVal.default,
          );
          if (checkedSet.has(confkey) && confval > confidenceThresh) {
            confidencePairIndex = 0;
          } else {
            confidencePairIndex = -1;
          }
        }
        /* include annotations where at least 1 confidence pair is above
         * the threshold and part of the checked type set */
        if (
          (confidencePairIndex >= 0 || annotation.confidencePairs.length === 0)
          && enabledInGroupFilters && !resultsIds.has(annotation.id)
        ) {
          let addValue = true;
          if (this.attributeFilters.value.length > 0 && params.getTrack !== undefined
            && this.enabledFilters.value.length > 0) {
            addValue = trackIdPassesFilter(
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

  updateTrackFilter(index: number, val: AttributeTrackFilter) {
    if (index < this.attributeFilters.value.length) {
      this.attributeFilters.value.splice(index, 1, val);
      this.userDefinedValues.value.splice(index, 1, val.filter.userDefined ? val.filter.val : null);
      this.enabledFilters.value.splice(index, 1, val.enabled);
    } else {
      this.attributeFilters.value.push(val);
      this.userDefinedValues.value.push(val.filter.userDefined ? val.filter.val : null);
      this.enabledFilters.value.push(val.enabled);
    }
    this.markChangesPending({ action: 'upsert', attributeTrackFilter: val });
  }

  deleteTrackFilter(index: number) {
    if (index < this.attributeFilters.value.length) {
      const items = this.attributeFilters.value.splice(index, 1);
      this.userDefinedValues.value.splice(index, 1);
      this.enabledFilters.value.splice(index, 1);
      this.markChangesPending({ action: 'delete', attributeTrackFilter: items[0] });
    }
  }

  setUserDefinedValue(index: number, val: userDefinedVals) {
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
