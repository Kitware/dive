import { computed, Ref, ref } from 'vue';
import { cloneDeep } from 'lodash';
import { clientSettings } from 'dive-common/store/settings';
import {
  compileHierarchy,
  normalizeTypeHierarchy,
  TypeHierarchy,
  TypeHierarchyError,
  TypeHierarchyIndex,
} from 'dive-common/typeHierarchy';
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

  typeHierarchy: Ref<TypeHierarchy | undefined>;

  hierarchyIndex: Ref<TypeHierarchyIndex | undefined>;

  hierarchyActive: Ref<boolean>;

  hierarchyMembers: Ref<string[]>;

  usedPlusConfiguredTypes: Ref<string[]>;

  invalidHierarchyReason: Ref<string | null>;

  private hierarchyWarningConsumed = false;

  private hierarchyDirty = false;

  private hierarchySavePrepared = false;

  private hierarchySaveRearmCount = ref(0);

  constructor(params: TrackFilterControlsParams) {
    super(params);

    const flatAllTypes = this.allTypes;
    this.usedPlusConfiguredTypes = flatAllTypes;
    this.typeHierarchy = ref(undefined);
    this.hierarchyIndex = ref(undefined);
    this.invalidHierarchyReason = ref(null);
    this.hierarchyMembers = computed(() => {
      const members = new Set<string>();
      Object.entries(this.typeHierarchy.value || {}).forEach(([child, parent]) => {
        members.add(child);
        members.add(parent);
      });
      return Array.from(members);
    });
    this.hierarchyActive = computed(() => this.hierarchyIndex.value !== undefined);
    this.allTypes = computed(() => Array.from(new Set([
      ...flatAllTypes.value,
      ...this.hierarchyMembers.value,
    ])));

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
        if (this.timeFilters.value !== null && !this.disableAnnotationFilters.value) {
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
        if (this.disableAnnotationFilters.value) {
          confidencePairIndex = 0;
        }
        /* include annotations where at least 1 confidence pair is above
         * the threshold and part of the checked type set */
        if (
          (confidencePairIndex >= 0 || annotation.confidencePairs.length === 0)
          && enabledInGroupFilters && !resultsIds.has(annotation.id)
        ) {
          let addValue = true;
          if (!this.disableAnnotationFilters.value && this.attributeFilters.value.length > 0 && params.getTrack !== undefined
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

  private installTypeHierarchy(value: unknown, dirty: boolean) {
    const previousMembers = new Set(this.hierarchyMembers.value);
    let normalized: TypeHierarchy | undefined;
    try {
      normalized = normalizeTypeHierarchy(value === undefined ? null : value);
      this.invalidHierarchyReason.value = null;
    } catch (error) {
      if (!(error instanceof TypeHierarchyError)) {
        throw error;
      }
      if (dirty) {
        throw error;
      }
      normalized = undefined;
      this.invalidHierarchyReason.value = error.reason;
    }

    const current = this.typeHierarchy.value;
    const changed = !isEqual(current, normalized);
    this.typeHierarchy.value = normalized;
    if (changed) {
      this.hierarchyIndex.value = normalized ? compileHierarchy(normalized) : undefined;
    }

    const nextMembers = new Set(this.hierarchyMembers.value);
    const baseline = new Set(this.usedPlusConfiguredTypes.value);
    const checked = this.checkedTypes.value.filter(
      (name) => baseline.has(name) || nextMembers.has(name),
    );
    nextMembers.forEach((name) => {
      if (!previousMembers.has(name) && !checked.includes(name)) {
        checked.push(name);
      }
    });
    this.checkedTypes.value = checked;

    this.hierarchyDirty = dirty;
    this.hierarchySavePrepared = false;
    if (!dirty) {
      this.hierarchySaveRearmCount.value = 0;
    }
  }

  /** Install hierarchy state loaded from a dataset or a successful config replacement. */
  setTypeHierarchy(value: unknown) {
    this.hierarchyWarningConsumed = false;
    this.installTypeHierarchy(value, false);
  }

  /** Install a locally edited hierarchy and include it in the next metadata save. */
  updateTypeHierarchy(value: unknown) {
    this.installTypeHierarchy(value, true);
    this.markChangesPending({ action: 'meta' });
  }

  consumeLoadWarning(): string | null {
    if (this.invalidHierarchyReason.value === null || this.hierarchyWarningConsumed) {
      return null;
    }
    this.hierarchyWarningConsumed = true;
    return `The saved type hierarchy is invalid: ${this.invalidHierarchyReason.value}. Hierarchical type selection is disabled until the configuration is corrected.`;
  }

  typeHierarchySavePatch(): { typeHierarchy?: Record<string, string> | null } {
    if (!this.hierarchyDirty) {
      return {};
    }
    if (this.typeHierarchy.value === undefined) {
      return { typeHierarchy: null };
    }
    return { typeHierarchy: { ...(this.typeHierarchy.value || {}) } };
  }

  /** Re-arm metadata writes for every save attempt while hierarchy state is dirty. */
  prepareTypeHierarchySavePatch(): { typeHierarchy?: Record<string, string> | null } {
    const patch = this.typeHierarchySavePatch();
    if (Object.prototype.hasOwnProperty.call(patch, 'typeHierarchy')) {
      if (this.hierarchySavePrepared) {
        this.markChangesPending({ action: 'meta' });
        this.hierarchySaveRearmCount.value += 1;
      } else {
        this.hierarchySavePrepared = true;
      }
    }
    return patch;
  }

  typeHierarchyPendingCountAdjustment() {
    return this.hierarchySaveRearmCount.value;
  }

  markTypeHierarchyPersisted() {
    this.hierarchyDirty = false;
    this.hierarchySavePrepared = false;
    this.hierarchySaveRearmCount.value = 0;
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
