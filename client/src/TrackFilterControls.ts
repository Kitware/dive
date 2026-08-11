import { computed, Ref, ref } from 'vue';
import { cloneDeep, isEqual } from 'lodash';
import { clientSettings } from 'dive-common/store/settings';
import {
  compileHierarchy,
  normalizeTypeHierarchy,
  selectFlatPairIndex,
  rewriteHierarchyType,
  selectPairIndex,
  TypeHierarchy,
  TypeHierarchyError,
  TypeHierarchyIndex,
} from 'dive-common/typeHierarchy';
import { AnnotationId } from './BaseAnnotation';
import BaseFilterControls, { AnnotationWithContext, FilterControlsParams } from './BaseFilterControls';
import type Group from './Group';
import type Track from './track';
import { AttributeTrackFilter, trackIdPassesFilter, userDefinedVals } from './AttributeTrackFilterControls';

export interface TypeHierarchySavePatch {
  typeHierarchy?: Record<string, string> | null;
}

interface TrackFilterControlsParams extends FilterControlsParams<Track> {
  lookupGroups: (annotationId: AnnotationId) => Group[];
  groupFilterControls: BaseFilterControls<Group>;
  getTracks: (annotationId: AnnotationId) => Track[];
  renameTrackPair: (
    annotationId: AnnotationId,
    currentType: string,
    newType: string,
  ) => [string, number][];
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

  invalidHierarchyReason: Ref<string | null>;

  private pendingLoadWarnings: string[] = [];

  private hierarchyDirty = false;

  private checkedTypesSet = computed(() => new Set(this.checkedTypes.value));

  private getTracks: (annotationId: AnnotationId) => Track[];

  private renameTrackPair: TrackFilterControlsParams['renameTrackPair'];

  constructor(params: TrackFilterControlsParams) {
    super(params);

    this.getTracks = params.getTracks;
    this.renameTrackPair = params.renameTrackPair;

    const flatAllTypes = this.allTypes;
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
      const checkedSet = this.checkedTypesSet.value;
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
        let confidencePairIndex: number;
        if (this.hierarchyActive.value) {
          confidencePairIndex = this.displayPairIndex(
            annotation as unknown as Readonly<Track>,
            -1,
          );
        } else {
          confidencePairIndex = selectFlatPairIndex(annotation.confidencePairs, {
            checkedSet,
            confidenceFilters: confidenceFiltersVal,
            filtersDisabled: this.disableAnnotationFilters.value,
            preventCascade: clientSettings.typeSettings.preventCascadeTypes ?? false,
          });
        }
        /* include annotations where at least 1 confidence pair is above
         * the threshold and part of the checked type set */
        if (
          (confidencePairIndex >= 0
            || (!this.hierarchyActive.value && annotation.confidencePairs.length === 0))
          && enabledInGroupFilters && !resultsIds.has(annotation.id)
        ) {
          let addValue = true;
          if (!this.disableAnnotationFilters.value && this.attributeFilters.value.length > 0
            && this.enabledFilters.value.length > 0) {
            const [canonicalTrack] = params.getTracks(annotation.id);
            if (canonicalTrack === undefined) {
              addValue = false;
            } else {
              addValue = trackIdPassesFilter(
                annotation.id,
                () => canonicalTrack,
                this.attributeFilters.value,
                this.userDefinedValues.value,
                this.enabledFilters.value,
                annotation.confidencePairs[confidencePairIndex]?.[0],
              );
            }
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

  displayPairIndex(track: Readonly<Track>, flatFallbackIndex: number): number {
    const index = this.hierarchyIndex.value;
    if (index === undefined) {
      return flatFallbackIndex;
    }
    if (track.confidencePairs.length === 0) {
      return -1;
    }
    if (this.disableAnnotationFilters.value) {
      return 0;
    }
    const checkedSet = this.checkedTypesSet.value;
    const confidenceFilters = this.confidenceFilters.value;
    const passes = track.confidencePairs.map(([confkey, confval]) => {
      const confidenceThresh = Math.max(
        confidenceFilters[confkey] || 0,
        confidenceFilters.default,
      );
      return confval >= confidenceThresh && checkedSet.has(confkey);
    });
    return selectPairIndex(index, track.confidencePairs, passes);
  }

  private installTypeHierarchy(value: unknown, dirty: boolean) {
    const previousTypes = new Set(this.allTypes.value);
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
      if (!previousTypes.has(name) && !checked.includes(name)) {
        checked.push(name);
      }
    });
    this.checkedTypes.value = checked;

    this.hierarchyDirty = dirty;
  }

  /** Install hierarchy state loaded from a dataset or a successful config replacement. */
  setTypeHierarchy(value: unknown) {
    this.pendingLoadWarnings = [];
    this.installTypeHierarchy(value, false);
    if (this.invalidHierarchyReason.value !== null) {
      this.queueLoadWarning(
        `The saved type hierarchy is invalid: ${this.invalidHierarchyReason.value}. Hierarchical type selection is disabled until the configuration is corrected.`,
      );
    }
  }

  /** Usage across every camera's stored vector, unlike the lossy merged `usedTypes`. */
  typeInUseOnAnyCamera(type: string): boolean {
    return this.sorted.value.some((annotation) => this.getTracks(annotation.id)
      .some((track) => track.confidencePairs.some(([name]) => name === type)));
  }

  updateTypeName({ currentType, newType }: { currentType: string; newType: string }) {
    if (!this.hierarchyActive.value) {
      this.sorted.value.forEach((annotation) => {
        if (this.getTracks(annotation.id)
          .some((track) => track.confidencePairs.some(([name]) => name === currentType))) {
          this.renameTrackPair(annotation.id, currentType, newType);
        }
      });
      if (!(newType in this.confidenceFilters.value)
        && currentType in this.confidenceFilters.value) {
        this.setConfidenceFilters({
          ...this.confidenceFilters.value,
          [newType]: this.confidenceFilters.value[currentType],
        });
      }
      this.deleteType(currentType);
      return;
    }
    const tracks = this.sorted.value.flatMap((annotation) => this.getTracks(annotation.id));
    const collision = tracks.find((track) => {
      const names = new Set(track.confidencePairs.map(([name]) => name));
      return names.has(currentType) && names.has(newType);
    });
    if (collision) {
      throw new TypeHierarchyError(
        `track ${collision.id} already contains both "${currentType}" and "${newType}"`,
        'conflict',
      );
    }

    const currentHierarchy = this.typeHierarchy.value as TypeHierarchy;
    const rewritten = rewriteHierarchyType(currentHierarchy, currentType, newType);
    const hierarchyChanged = !isEqual(currentHierarchy, rewritten);
    const currentWasChecked = this.checkedTypes.value.includes(currentType);
    const newWasChecked = this.checkedTypes.value.includes(newType);

    this.sorted.value.forEach((annotation) => {
      if (this.getTracks(annotation.id)
        .some((track) => track.confidencePairs.some(([name]) => name === currentType))) {
        this.renameTrackPair(annotation.id, currentType, newType);
      }
    });
    if (!(newType in this.confidenceFilters.value)
      && currentType in this.confidenceFilters.value) {
      this.setConfidenceFilters({
        ...this.confidenceFilters.value,
        [newType]: this.confidenceFilters.value[currentType],
      });
    }
    if (this.configuredTypes.value.includes(currentType)
      && !this.configuredTypes.value.includes(newType)) {
      this.configuredTypes.value.push(newType);
    }
    this.deleteTypeConfiguration(currentType);
    if (hierarchyChanged) {
      this.installTypeHierarchy(rewritten, true);
    }

    const checked = new Set(this.checkedTypes.value);
    if (!currentWasChecked && !newWasChecked) {
      checked.delete(newType);
    } else if (currentWasChecked) {
      checked.add(newType);
    }
    if (!this.allTypes.value.includes(currentType)) {
      checked.delete(currentType);
    }
    this.checkedTypes.value = Array.from(checked);
    this.markChangesPending({ action: 'meta' });
  }

  deleteType(type: string): boolean {
    if (!this.hierarchyActive.value) {
      return super.deleteType(type);
    }
    if (this.typeInUseOnAnyCamera(type)) {
      return false;
    }
    this.deleteTypeConfiguration(type);
    this.markChangesPending({ action: 'meta' });
    return true;
  }

  queueLoadWarning(message: string): void {
    if (!this.pendingLoadWarnings.includes(message)) {
      this.pendingLoadWarnings.push(message);
    }
  }

  consumeLoadWarning(): string | null {
    return this.pendingLoadWarnings.shift() || null;
  }

  typeHierarchySavePatch(): TypeHierarchySavePatch {
    if (!this.hierarchyDirty) {
      return {};
    }
    if (this.typeHierarchy.value === undefined) {
      return { typeHierarchy: null };
    }
    return { typeHierarchy: { ...(this.typeHierarchy.value || {}) } };
  }

  // A save is asynchronous, so the hierarchy can be edited again while one is in flight. Only
  // the state that was actually sent may be acknowledged; anything newer stays dirty.
  markTypeHierarchyPersisted(persisted: TypeHierarchySavePatch) {
    if (isEqual(this.typeHierarchySavePatch(), persisted)) {
      this.hierarchyDirty = false;
    }
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
