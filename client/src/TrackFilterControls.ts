import type { TaxonomySources } from 'dive-common/worms';
import { computed, Ref, ref } from 'vue';
import { cloneDeep, isEqual } from 'lodash';
import { clientSettings } from 'dive-common/store/settings';
import {
  compileHierarchy,
  normalizeTypeHierarchy,
  removeHierarchyType,
  resolveConfidenceThreshold,
  resolveTypeHierarchy,
  rewriteHierarchyType,
  selectFlatPairIndex,
  selectPairIndex,
  TypeHierarchy,
  TypeHierarchyError,
  TypeHierarchyIndex,
  updateHierarchyTypeDefinition,
} from 'dive-common/typeHierarchy';
import { AnnotationId } from './BaseAnnotation';
import BaseFilterControls, { AnnotationWithContext, FilterControlsParams } from './BaseFilterControls';
import type Group from './Group';
import type Track from './track';
import { AttributeTrackFilter, trackIdPassesFilter, userDefinedVals } from './AttributeTrackFilterControls';

export interface TypeHierarchySavePatch {
  typeHierarchy?: Record<string, string> | null;
}

export interface TypeDefinitionParams {
  currentType: string;
  newType: string;
  parent: string | undefined;
}

export interface TypeDefinitionValidationError {
  field: 'name' | 'parent';
  reason: string;
}

interface PreparedTypeDefinition {
  nextHierarchy: TypeHierarchy | undefined;
  nameChanged: boolean;
  hierarchyChanged: boolean;
  hierarchyInvolved: boolean;
  survivingHierarchyTypes: Set<string>;
}

type TypeDefinitionPreflight =
  | { prepared: PreparedTypeDefinition; error?: undefined }
  | { prepared?: undefined; error: TypeDefinitionValidationError & { cause: TypeHierarchyError } };

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

function hierarchyTypes(hierarchy: TypeHierarchy | undefined): Set<string> {
  const types = new Set<string>();
  Object.entries(hierarchy || {}).forEach(([child, parent]) => {
    types.add(child);
    types.add(parent);
  });
  return types;
}

export default class TrackFilterControls extends BaseFilterControls<Track> {
  filteredAnnotations: Ref<AnnotationWithContext<Track>[]>;

  userDefinedValues: Ref<userDefinedVals[]>;

  attributeFilters: Ref<AttributeTrackFilter[]>;

  enabledFilters: Ref<boolean[]>;

  taxonomySources = ref<TaxonomySources>({});

  private taxonomyDirty = false;

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

  private lookupGroups: TrackFilterControlsParams['lookupGroups'];

  private groupFilterControls: TrackFilterControlsParams['groupFilterControls'];

  constructor(params: TrackFilterControlsParams) {
    super(params);

    this.getTracks = params.getTracks;
    this.renameTrackPair = params.renameTrackPair;
    this.lookupGroups = params.lookupGroups;
    this.groupFilterControls = params.groupFilterControls;

    const flatAllTypes = this.allTypes;
    this.typeHierarchy = ref(undefined);
    this.hierarchyIndex = ref(undefined);
    this.invalidHierarchyReason = ref(null);
    this.hierarchyMembers = computed(() => Array.from(hierarchyTypes(this.typeHierarchy.value)));
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
      const enabledGroupIds = this.enabledGroupIds();
      const confidenceFiltersVal = cloneDeep(this.confidenceFilters.value);
      const resultsArr: AnnotationWithContext<Track>[] = [];
      const resultsIds: Set<AnnotationId> = new Set();
      this.sorted.value.forEach((annotation) => {
        if (!this.passesTimeAndGroupFilters(annotation, enabledGroupIds)) {
          return;
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
          && !resultsIds.has(annotation.id)
          && this.passesAttributeFilters(
            annotation.id,
            annotation.confidencePairs[confidencePairIndex]?.[0],
          )
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

  private enabledGroupIds(): Set<AnnotationId> {
    return new Set(this.groupFilterControls.enabledAnnotations.value
      .map((v) => v.annotation.id));
  }

  /** Time range and group-membership checks shared by the list and below-threshold delete. */
  private passesTimeAndGroupFilters(
    annotation: { id: AnnotationId; begin: number; end: number },
    enabledGroupIds: Set<AnnotationId>,
  ): boolean {
    if (this.timeFilters.value !== null && !this.disableAnnotationFilters.value) {
      const [startTime, endTime] = this.timeFilters.value;
      if (annotation.begin > endTime || annotation.end < startTime) {
        return false;
      }
    }
    const groups = this.lookupGroups(annotation.id);
    if (groups.length) {
      return groups.some((group) => enabledGroupIds.has(group.id));
    }
    return true;
  }

  private passesAttributeFilters(
    annotationId: AnnotationId,
    displayType: string | undefined,
  ): boolean {
    if (this.disableAnnotationFilters.value || this.attributeFilters.value.length === 0
      || this.enabledFilters.value.length === 0) {
      return true;
    }
    const [canonicalTrack] = this.getTracks(annotationId);
    if (canonicalTrack === undefined) {
      return false;
    }
    return trackIdPassesFilter(
      annotationId,
      () => canonicalTrack,
      this.attributeFilters.value,
      this.userDefinedValues.value,
      this.enabledFilters.value,
      displayType,
    );
  }

  /**
   * Tracks with enabled classes that fail their confidence thresholds, after the
   * same time / group / attribute filters the track list applies.
   */
  annotationIdsBelowThreshold(types: string[]): AnnotationId[] {
    const wanted = new Set(types);
    const filters = this.confidenceFilters.value;
    const enabledGroupIds = this.enabledGroupIds();
    return this.sorted.value.filter((annotation) => {
      if (!this.passesTimeAndGroupFilters(annotation, enabledGroupIds)) {
        return false;
      }
      const matching = annotation.confidencePairs.filter(([type]) => wanted.has(type));
      if (matching.length === 0 || matching.some(([type, confidence]) => (
        confidence >= resolveConfidenceThreshold(filters, type)
      ))) {
        return false;
      }
      const displayType = matching.reduce((best, pair) => (
        pair[1] > best[1] ? pair : best
      ))[0];
      return this.passesAttributeFilters(annotation.id, displayType);
    }).map(({ id }) => id);
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
    const passes = track.confidencePairs.map(([confkey, confval]) => (
      confval >= resolveConfidenceThreshold(confidenceFilters, confkey)
      && checkedSet.has(confkey)
    ));
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

  /** Validate the entire additive import before changing types or hierarchy. */
  importCategoryDefinitions(types: string[], hierarchy?: TypeHierarchy, sources?: TaxonomySources) {
    const resolved = resolveTypeHierarchy(this.typeHierarchy.value ?? null, true, hierarchy ?? {}, 'additive');
    if (resolved.action === 'set' && !isEqual(resolved.hierarchy, this.typeHierarchy.value)) {
      this.installTypeHierarchy(resolved.hierarchy, true);
    }
    if (sources && Object.keys(sources).length) {
      this.taxonomySources.value = { ...this.taxonomySources.value, ...sources };
      this.taxonomyDirty = true;
    }
    this.importTypes(types);
  }

  setTaxonomySources(sources?: TaxonomySources) {
    this.taxonomySources.value = sources ?? {};
    this.taxonomyDirty = false;
  }

  taxonomySavePatch(): { taxonomySources?: TaxonomySources } {
    return this.taxonomyDirty ? { taxonomySources: { ...this.taxonomySources.value } } : {};
  }

  markTaxonomyPersisted(patch: { taxonomySources?: TaxonomySources }) {
    if (isEqual(patch, this.taxonomySavePatch())) this.taxonomyDirty = false;
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

  private configureStandaloneTypes(
    types: ReadonlySet<string>,
    hierarchy: TypeHierarchy | undefined,
  ) {
    const hierarchyMembers = hierarchyTypes(hierarchy);
    const retainedTypes = new Set(this.usedPlusConfiguredTypes.value);
    types.forEach((type) => {
      if (!hierarchyMembers.has(type) && !retainedTypes.has(type)) {
        this.configuredTypes.value.push(type);
      }
    });
  }

  updateTypeName({ currentType, newType }: { currentType: string; newType: string }) {
    if (!this.hierarchyActive.value) {
      this.sorted.value.forEach((annotation) => {
        if (this.getTracks(annotation.id)
          .some((track) => track.confidencePairs.some(([name]) => name === currentType))) {
          this.renameTrackPair(annotation.id, currentType, newType);
        }
      });
      this.carryConfidenceFilter(currentType, newType);
      this.deleteType(currentType);
      return;
    }
    this.updateTypeDefinition({
      currentType,
      newType,
      parent: this.typeHierarchy.value?.[currentType],
    });
  }

  private preflightTypeDefinition({
    currentType,
    newType,
    parent,
  }: TypeDefinitionParams): TypeDefinitionPreflight {
    let prepared: PreparedTypeDefinition;
    let structuralErrorField: TypeDefinitionValidationError['field'] = 'parent';
    try {
      if (parent === currentType && currentType !== newType) {
        throw new TypeHierarchyError(
          `the original type "${currentType}" cannot be its renamed type's parent`,
          'conflict',
        );
      }
      if (parent !== undefined && !this.allTypes.value.includes(parent)) {
        throw new TypeHierarchyError(
          `parent "${parent}" is not an existing type`,
          'conflict',
        );
      }

      const currentHierarchy = this.typeHierarchy.value;
      const currentParent = currentHierarchy?.[currentType];
      const nameChanged = currentType !== newType;
      const parentChanged = parent !== currentParent;
      structuralErrorField = nameChanged && !parentChanged ? 'name' : 'parent';
      const survivingHierarchyTypes = hierarchyTypes(currentHierarchy);
      if (nameChanged && survivingHierarchyTypes.delete(currentType)) {
        survivingHierarchyTypes.add(newType);
      }
      const nextHierarchy = nameChanged && !parentChanged && currentHierarchy !== undefined
        ? rewriteHierarchyType(currentHierarchy, currentType, newType)
        : updateHierarchyTypeDefinition(currentHierarchy, currentType, newType, parent);
      prepared = {
        nextHierarchy,
        nameChanged,
        hierarchyChanged: !isEqual(currentHierarchy, nextHierarchy),
        hierarchyInvolved: currentHierarchy !== undefined || nextHierarchy !== undefined,
        survivingHierarchyTypes,
      };
    } catch (error) {
      if (error instanceof TypeHierarchyError) {
        return {
          error: { field: structuralErrorField, reason: error.reason, cause: error },
        };
      }
      throw error;
    }

    if (prepared.nameChanged && prepared.hierarchyInvolved) {
      const collision = this.sorted.value
        .flatMap((annotation) => this.getTracks(annotation.id))
        .find((track) => {
          const names = new Set(track.confidencePairs.map(([name]) => name));
          return names.has(currentType) && names.has(newType);
        });
      if (collision) {
        const cause = new TypeHierarchyError(
          `track ${collision.id} already contains both "${currentType}" and "${newType}"`,
          'conflict',
        );
        return {
          error: { field: 'name', reason: cause.reason, cause },
        };
      }
    }
    return { prepared };
  }

  validateTypeDefinition(params: TypeDefinitionParams): TypeDefinitionValidationError | undefined {
    const { error } = this.preflightTypeDefinition(params);
    return error && { field: error.field, reason: error.reason };
  }

  updateTypeDefinition(params: TypeDefinitionParams) {
    const preflight = this.preflightTypeDefinition(params);
    if (preflight.error) {
      throw preflight.error.cause;
    }
    const {
      nextHierarchy,
      nameChanged,
      hierarchyChanged,
      hierarchyInvolved,
      survivingHierarchyTypes,
    } = preflight.prepared;
    const { currentType, newType } = params;
    if (!nameChanged && !hierarchyChanged) {
      return;
    }
    if (!hierarchyInvolved) {
      this.updateTypeName({ currentType, newType });
      return;
    }

    const currentWasChecked = this.checkedTypes.value.includes(currentType);
    const newWasChecked = this.checkedTypes.value.includes(newType);
    const currentWasConfigured = this.configuredTypes.value.includes(currentType);

    if (nameChanged) {
      this.sorted.value.forEach((annotation) => {
        if (this.getTracks(annotation.id)
          .some((track) => track.confidencePairs.some(([name]) => name === currentType))) {
          this.renameTrackPair(annotation.id, currentType, newType);
        }
      });
      this.carryConfidenceFilter(currentType, newType);
      if (currentWasConfigured && !this.configuredTypes.value.includes(newType)) {
        this.configuredTypes.value.push(newType);
      }
      this.deleteTypeConfiguration(currentType);
    }
    this.configureStandaloneTypes(survivingHierarchyTypes, nextHierarchy);
    if (hierarchyChanged) {
      this.installTypeHierarchy(nextHierarchy, true);
    }

    const checked = new Set(this.checkedTypes.value);
    if (nameChanged) {
      if (!currentWasChecked && !newWasChecked) {
        checked.delete(newType);
      } else if (currentWasChecked) {
        checked.add(newType);
      }
      if (!this.allTypes.value.includes(currentType)) {
        checked.delete(currentType);
      }
    }
    this.checkedTypes.value = Array.from(checked);
    this.markChangesPending({ action: 'meta' });
  }

  deleteType(type: string): boolean {
    const currentHierarchy = this.typeHierarchy.value;
    if (currentHierarchy === undefined || !this.hierarchyMembers.value.includes(type)) {
      return super.deleteType(type);
    }
    if (this.typeInUseOnAnyCamera(type)) {
      return false;
    }
    const nextHierarchy = removeHierarchyType(currentHierarchy, type);
    const survivingHierarchyTypes = hierarchyTypes(currentHierarchy);
    survivingHierarchyTypes.delete(type);
    this.configureStandaloneTypes(survivingHierarchyTypes, nextHierarchy);
    this.installTypeHierarchy(nextHierarchy, true);
    this.checkedTypes.value = this.checkedTypes.value.filter((name) => name !== type);
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
