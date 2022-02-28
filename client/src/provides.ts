import IntervalTree from '@flatten-js/interval-tree';
import {
  provide, inject, ref, Ref,
} from '@vue/composition-api';

import { AnnotatorPreferences as AnnotatorPrefsIface } from './types';
import { CustomStyle, StateStyles, TypeStyling } from './use/useStyling';
import { EditAnnotationTypes } from './layers/EditAnnotationLayer';
import Track, { TrackId } from './track';
import { VisibleAnnotationTypes } from './layers';
import { RectBounds } from './utils';
import { Attribute } from './use/useAttributes';
import { DefaultConfidence, TrackWithContext } from './use/useTrackFilters';
import { Time } from './use/useTimeObserver';

/**
 * Type definitions are read only because injectors may mutate internal state,
 * but should never overwrite or delete the injected object.
 */

const AnnotatorPreferencesSymbol = Symbol('annotatorPreferences');
type AnnotatorPreferences = Readonly<Ref<AnnotatorPrefsIface>>;

const AttributesSymbol = Symbol('attributes');
type AttributesType = Readonly<Ref<Attribute[]>>;

const AllTypesSymbol = Symbol('allTypes');
type AllTypesType = Readonly<Ref<readonly string[]>>;

const DatasetIdSymbol = Symbol('datasetID');
type DatasetIdType = Readonly<Ref<string>>;

const UsedTypesSymbol = Symbol('usedTypes');
type UsedTypesType = Readonly<Ref<readonly string[]>>;

const CheckedTrackIdsSymbol = Symbol('checkedTrackIds');
type CheckedTrackIdsType = Readonly<Ref<readonly TrackId[]>>;

const CheckedTypesSymbol = Symbol('checkedTypes');
type CheckedTypesType = Readonly<Ref<readonly string[]>>;

const ConfidenceFiltersSymbol = Symbol('confidenceFilters');
type ConfidenceFiltersType = Readonly<Ref<Readonly<Record<string, number>>>>;

const EnabledTracksSymbol = Symbol('enabledTracks');
type EnabledTracksType = Readonly<Ref<readonly TrackWithContext[]>>;

const EditingModeSymbol = Symbol('editingMode');
type EditingModeType = Readonly<Ref<false | EditAnnotationTypes>>;

const MergeListSymbol = Symbol('mergeList');
type MergeList = Readonly<Ref<readonly TrackId[]>>;

const PendingSaveCountSymbol = Symbol('pendingSaveCount');
type pendingSaveCountType = Readonly<Ref<number>>;

const IntervalTreeSymbol = Symbol('intervalTree');
type IntervalTreeType = Readonly<IntervalTree>;

const RevisionIdSymbol = Symbol('revisionId');
type RevisionIdType = Readonly<Ref<number>>;

const TrackMapSymbol = Symbol('trackMap');
type TrackMapType = Readonly<Map<TrackId, Track>>;

const TracksSymbol = Symbol('tracks');
type FilteredTracksType = Readonly<Ref<readonly TrackWithContext[]>>;

const TypeStylingSymbol = Symbol('typeStyling');
type TypeStylingType = Readonly<Ref<TypeStyling>>;

const SelectedKeySymbol = Symbol('selectedKey');
type SelectedKeyType = Readonly<Ref<string>>;

const SelectedTrackIdSymbol = Symbol('selectedTrackId');
type SelectedTrackIdType = Readonly<Ref<TrackId | null>>;

const StateStylesSymbol = Symbol('stateStyles');
type StateStylesType = Readonly<StateStyles>;

const TimeSymbol = Symbol('time');
type TimeType = Readonly<Time>;

const VisibleModesSymbol = Symbol('visibleModes');
type VisibleModesType = Readonly<Ref<readonly VisibleAnnotationTypes[]>>;

const ReadOnlyModeSymbol = Symbol('readOnlyMode');
type ReadOnylModeType = Readonly<Ref<boolean>>;

/**
 * Handler interface describes all global events mutations
 * for above state
 */
export interface Handler {
  /* Save pending changes to persistence layer */
  save(): Promise<void>;
  /* Select and seek to track */
  trackSeek(trackId: TrackId): void;
  /* Toggle editing mode for track */
  trackEdit(trackId: TrackId): void;
  /* set checked track ids */
  trackEnable(trackId: TrackId, value: boolean): void;
  /* toggle selection mode for track */
  trackSelect(trackId: TrackId | null, edit: boolean): void;
  /* select next track in the list */
  trackSelectNext(delta: number): void;
  /* split track */
  trackSplit(trackId: TrackId | null, frame: number): void;
  /* Change tracks difinitive type */
  trackTypeChange(trackId: TrackId | null, value: string): void;
  /* Add new empty track and select it */
  trackAdd(): TrackId;
  /* update Rectangle bounds for track */
  updateRectBounds(
    frameNum: number,
    flickNum: number,
    bounds: RectBounds,
  ): void;
  /* update geojson for track */
  updateGeoJSON(
    eventType: 'in-progress' | 'editing',
    frameNum: number,
    flickNum: number,
    data: GeoJSON.Feature,
    key?: string,
    preventInterrupt?: () => void,
  ): void;
  /* Remove a whole track */
  removeTrack(trackIds: TrackId[], forcePromptDisable?: boolean): void;
  /* Remove a single point from selected track's geometry by selected index */
  removePoint(): void;
  /* Remove an entire annotation from selected track by selected key */
  removeAnnotation(): void;
  /* set selectFeatureHandle and selectedKey */
  selectFeatureHandle(i: number, key: string): void;
  /* set checked type strings */
  setCheckedTypes(types: string[]): void;
  /* set checked type strings */
  removeTypeTracks(types: string[]): void;
  /* removes an individual type */
  deleteType(types: string): void;
  /* Change type name */
  updateTypeName({ currentType, newType }: { currentType: string; newType: string }): void;
  /* change styles */
  updateTypeStyle(args: {
    type: string;
    value: CustomStyle;
  }): void;
  /* set an Attribute in the metaData */
  setAttribute({ data, oldAttribute }:
    { data: Attribute; oldAttribute?: Attribute }, updateAllTracks?: boolean): void;
  /* set confidence thresholds  */
  setConfidenceFilters(val: Record<string, number>): void;
  /* delete an Attribute in the metaData */
  deleteAttribute({ data }: { data: Attribute }, removeFromTracks?: boolean): void;
  /* Commit the staged merge tracks */
  commitMerge(): void;
  /* Turn merge mode on and off */
  toggleMerge(): TrackId[];
  /* Remove trackIds from merge */
  unstageFromMerge(ids: TrackId[]): void;
  /* Reload Annotation File */
  reloadAnnotations(): Promise<void>;
  /* Check out a different revision */
  checkout(revisionId: number): void;
}
const HandlerSymbol = Symbol('handler');


/**
 * Make a trivial noop handler. Useful if you only intend to
 * override some small number of values.
 * @param handle callbacl for all handler methods
 */
function dummyHandler(handle: (name: string, args: unknown[]) => void): Handler {
  return {
    save(...args) { handle('save', args); return Promise.resolve(); },
    trackSeek(...args) { handle('trackSeek', args); },
    trackEdit(...args) { handle('trackEdit', args); },
    trackEnable(...args) { handle('trackEnable', args); },
    trackSelect(...args) { handle('trackSelect', args); },
    trackSelectNext(...args) { handle('trackSelectNext', args); },
    trackSplit(...args) { handle('trackSplit', args); },
    trackTypeChange(...args) { handle('trackTypeChange', args); },
    trackAdd(...args) { handle('trackAdd', args); return 0; },
    updateRectBounds(...args) { handle('updateRectBounds', args); },
    updateGeoJSON(...args) { handle('updateGeoJSON', args); },
    removeTrack(...args) { handle('removeTrack', args); },
    removePoint(...args) { handle('removePoint', args); },
    removeAnnotation(...args) { handle('removeAnnotation', args); },
    selectFeatureHandle(...args) { handle('selectFeatureHandle', args); },
    setCheckedTypes(...args) { handle('setCheckedTypes', args); },
    removeTypeTracks(...args) { handle('removeTypeTracks', args); },
    deleteType(...args) { handle('deleteType', args); },
    updateTypeName(...args) { handle('updateTypeName', args); },
    updateTypeStyle(...args) { handle('updateTypeStyle', args); },
    setAttribute(...args) { handle('setAttribute', args); },
    setConfidenceFilters(...args) { handle('setConfidenceFilters', args); },
    deleteAttribute(...args) { handle('deleteAttribute', args); },
    toggleMerge(...args) { handle('toggleMerge', args); return []; },
    commitMerge(...args) { handle('commitMerge', args); },
    unstageFromMerge(...args) { handle('unstageFromMerge', args); },
    reloadAnnotations(...args) { handle('reloadTracks', args); return Promise.resolve(); },
    checkout(...args) { handle('checkout', args); },
  };
}

/**
 * State interface describes the reactive properties that should be provided
 * by a vue-media-annotator consumer.
 *
 * Implementations of most of this state is provided via src/use, but some
 * you will need to construct on your own.
 */
export interface State {
  annotatorPreferences: AnnotatorPreferences;
  attributes: AttributesType;
  allTypes: AllTypesType;
  datasetId: DatasetIdType;
  usedTypes: UsedTypesType;
  checkedTrackIds: CheckedTrackIdsType;
  checkedTypes: CheckedTypesType;
  confidenceFilters: ConfidenceFiltersType;
  editingMode: EditingModeType;
  enabledTracks: EnabledTracksType;
  filteredTracks: FilteredTracksType;
  intervalTree: IntervalTreeType;
  mergeList: MergeList;
  pendingSaveCount: pendingSaveCountType;
  revisionId: RevisionIdType;
  trackMap: TrackMapType;
  typeStyling: TypeStylingType;
  selectedKey: SelectedKeyType;
  selectedTrackId: SelectedTrackIdType;
  stateStyles: StateStylesType;
  time: TimeType;
  visibleModes: VisibleModesType;
  readOnlyMode: ReadOnylModeType;
}

/**
 * make a trivial state store. Useful if you only
 * intend to override some small number of values.
 */
function dummyState(): State {
  const style = {
    strokeWidth: 2,
    opacity: 1,
    color: 'white',
    fill: false,
    showLabel: true,
    showConfidence: true,
  };
  return {
    annotatorPreferences: ref({ trackTails: { before: 20, after: 10 } }),
    attributes: ref([]),
    allTypes: ref([]),
    datasetId: ref(''),
    usedTypes: ref([]),
    checkedTrackIds: ref([]),
    checkedTypes: ref([]),
    confidenceFilters: ref({ default: DefaultConfidence }),
    editingMode: ref(false),
    enabledTracks: ref([]),
    filteredTracks: ref([]),
    intervalTree: new IntervalTree(),
    mergeList: ref([]),
    pendingSaveCount: ref(0),
    revisionId: ref(0),
    trackMap: new Map<TrackId, Track>(),
    typeStyling: ref({
      color() { return style.color; },
      strokeWidth() { return style.strokeWidth; },
      opacity() { return style.opacity; },
      fill() { return style.fill; },
      labelSettings() {
        return { showLabel: style.showLabel, showConfidence: style.showConfidence };
      },
    }),
    selectedKey: ref(''),
    selectedTrackId: ref(null),
    stateStyles: {
      disabled: style,
      selected: style,
      standard: style,
    },
    time: {
      frame: ref(0),
      flick: ref(0),
      frameRate: ref(0),
      originalFps: ref(null),
    },
    visibleModes: ref(['rectangle', 'text'] as VisibleAnnotationTypes[]),
    readOnlyMode: ref(false),
  };
}

/**
 * Provide global state and handler for a single instance
 * of vue-media-annotator.  Multiple annotator windows
 * are currently not supported.
 *
 * @param {State} state
 * @param {Hander} handler
 */
function provideAnnotator(state: State, handler: Handler) {
  provide(AnnotatorPreferencesSymbol, state.annotatorPreferences);
  provide(AttributesSymbol, state.attributes);
  provide(AllTypesSymbol, state.allTypes);
  provide(DatasetIdSymbol, state.datasetId);
  provide(UsedTypesSymbol, state.usedTypes);
  provide(CheckedTrackIdsSymbol, state.checkedTrackIds);
  provide(CheckedTypesSymbol, state.checkedTypes);
  provide(ConfidenceFiltersSymbol, state.confidenceFilters);
  provide(EnabledTracksSymbol, state.enabledTracks);
  provide(EditingModeSymbol, state.editingMode);
  provide(IntervalTreeSymbol, state.intervalTree);
  provide(MergeListSymbol, state.mergeList);
  provide(PendingSaveCountSymbol, state.pendingSaveCount);
  provide(RevisionIdSymbol, state.revisionId);
  provide(TrackMapSymbol, state.trackMap);
  provide(TracksSymbol, state.filteredTracks);
  provide(TypeStylingSymbol, state.typeStyling);
  provide(SelectedKeySymbol, state.selectedKey);
  provide(SelectedTrackIdSymbol, state.selectedTrackId);
  provide(StateStylesSymbol, state.stateStyles);
  provide(TimeSymbol, state.time);
  provide(VisibleModesSymbol, state.visibleModes);
  provide(ReadOnlyModeSymbol, state.readOnlyMode);
  provide(HandlerSymbol, handler);
}

function _handleMissing(s: symbol): Error {
  return new Error(`Missing provided object for symbol ${s.toString()}: must provideAnnotator()`);
}

function use<T>(s: symbol) {
  const v = inject<T>(s);
  if (v === undefined) {
    throw _handleMissing(s);
  }
  return v;
}

function useAnnotatorPreferences() {
  return use<AnnotatorPreferences>(AnnotatorPreferencesSymbol);
}

function useAttributes() {
  return use<AttributesType>(AttributesSymbol);
}

function useAllTypes() {
  return use<AllTypesType>(AllTypesSymbol);
}
function useDatasetId() {
  return use<DatasetIdType>(DatasetIdSymbol);
}
function useUsedTypes() {
  return use<UsedTypesType>(UsedTypesSymbol);
}

function useCheckedTrackIds() {
  return use<CheckedTrackIdsType>(CheckedTrackIdsSymbol);
}

function useCheckedTypes() {
  return use<CheckedTypesType>(CheckedTypesSymbol);
}

function useConfidenceFilters() {
  return use<ConfidenceFiltersType>(ConfidenceFiltersSymbol);
}

function useEnabledTracks() {
  return use<EnabledTracksType>(EnabledTracksSymbol);
}

function useEditingMode() {
  return use<EditingModeType>(EditingModeSymbol);
}

function useHandler() {
  return use<Handler>(HandlerSymbol);
}

function useIntervalTree() {
  return use<IntervalTreeType>(IntervalTreeSymbol);
}

function useMergeList() {
  return use<MergeList>(MergeListSymbol);
}

function usePendingSaveCount() {
  return use<pendingSaveCountType>(PendingSaveCountSymbol);
}

function useRevisionId() {
  return use<RevisionIdType>(RevisionIdSymbol);
}

function useTrackMap() {
  return use<TrackMapType>(TrackMapSymbol);
}

function useFilteredTracks() {
  return use<FilteredTracksType>(TracksSymbol);
}

function useTypeStyling() {
  return use<TypeStylingType>(TypeStylingSymbol);
}

function useSelectedKey() {
  return use<SelectedKeyType>(SelectedKeySymbol);
}

function useSelectedTrackId() {
  return use<SelectedTrackIdType>(SelectedTrackIdSymbol);
}

function useStateStyles() {
  return use<StateStylesType>(StateStylesSymbol);
}

function useTime() {
  return use<TimeType>(TimeSymbol);
}

function useVisibleModes() {
  return use<VisibleModesType>(VisibleModesSymbol);
}
function useReadOnlyMode() {
  return use<ReadOnylModeType>(ReadOnlyModeSymbol);
}

export {
  dummyHandler,
  dummyState,
  provideAnnotator,
  use,
  useAnnotatorPreferences,
  useAttributes,
  useAllTypes,
  useDatasetId,
  useUsedTypes,
  useCheckedTrackIds,
  useCheckedTypes,
  useConfidenceFilters,
  useEnabledTracks,
  useEditingMode,
  useHandler,
  useIntervalTree,
  useMergeList,
  usePendingSaveCount,
  useTrackMap,
  useFilteredTracks,
  useRevisionId,
  useTypeStyling,
  useSelectedKey,
  useSelectedTrackId,
  useStateStyles,
  useTime,
  useVisibleModes,
  useReadOnlyMode,
};
