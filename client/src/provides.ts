import {
  provide, inject, ref, Ref, reactive,
} from '@vue/composition-api';

import { AnnotatorPreferences as AnnotatorPrefsIface } from './types';
import StyleManager from './StyleManager';
import { EditAnnotationTypes } from './layers/EditAnnotationLayer';
import TrackStore from './TrackStore';
import GroupStore from './GroupStore';
import type { TrackId } from './track';
import { VisibleAnnotationTypes } from './layers';
import { RectBounds } from './utils';
import { Attribute } from './use/useAttributes';
import { DefaultConfidence, TrackWithContext } from './use/useAnnotationFilters';
import { Time } from './use/useTimeObserver';
import { ImageEnhancements } from './use/useImageEnhancements';

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

const GroupStoreSymbol = Symbol('groupStore');

const MergeListSymbol = Symbol('mergeList');
type MergeList = Readonly<Ref<readonly TrackId[]>>;

const PendingSaveCountSymbol = Symbol('pendingSaveCount');
type pendingSaveCountType = Readonly<Ref<number>>;

const ProgressSymbol = Symbol('progress');
type ProgressType = Readonly<{ loaded: boolean }>;

const RevisionIdSymbol = Symbol('revisionId');
type RevisionIdType = Readonly<Ref<number>>;

const TrackStoreSymbol = Symbol('trackStore');

const TracksSymbol = Symbol('tracks');
type FilteredTracksType = Readonly<Ref<readonly TrackWithContext[]>>;

const TrackStyleManagerSymbol = Symbol('trackTypeStyling');
const GroupStyleManagerSymbol = Symbol('groupTypeStyling');

const SelectedKeySymbol = Symbol('selectedKey');
type SelectedKeyType = Readonly<Ref<string>>;

const SelectedTrackIdSymbol = Symbol('selectedTrackId');
type SelectedTrackIdType = Readonly<Ref<TrackId | null>>;

const TimeSymbol = Symbol('time');
type TimeType = Readonly<Time>;

const VisibleModesSymbol = Symbol('visibleModes');
type VisibleModesType = Readonly<Ref<readonly VisibleAnnotationTypes[]>>;

const ReadOnlyModeSymbol = Symbol('readOnlyMode');
type ReadOnylModeType = Readonly<Ref<boolean>>;

const ImageEnhancementsSymbol = Symbol('imageEnhancements');
type ImageEnhancementsType = Readonly<Ref<ImageEnhancements>>;

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
  setSVGFilters({ blackPoint, whitePoint }: {blackPoint?: number; whitePoint?: number}): void;
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
    setAttribute(...args) { handle('setAttribute', args); },
    setConfidenceFilters(...args) { handle('setConfidenceFilters', args); },
    deleteAttribute(...args) { handle('deleteAttribute', args); },
    toggleMerge(...args) { handle('toggleMerge', args); return []; },
    commitMerge(...args) { handle('commitMerge', args); },
    unstageFromMerge(...args) { handle('unstageFromMerge', args); },
    reloadAnnotations(...args) { handle('reloadTracks', args); return Promise.resolve(); },
    setSVGFilters(...args) { handle('setSVGFilter', args); },
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
  groupStore: GroupStore;
  groupStyleManager: StyleManager;
  mergeList: MergeList;
  pendingSaveCount: pendingSaveCountType;
  progress: ProgressType;
  revisionId: RevisionIdType;
  selectedKey: SelectedKeyType;
  selectedTrackId: SelectedTrackIdType;
  time: TimeType;
  trackStore: TrackStore;
  trackStyleManager: StyleManager;
  visibleModes: VisibleModesType;
  readOnlyMode: ReadOnylModeType;
  imageEnhancements: ImageEnhancementsType;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const markChangesPending = () => { };

/**
 * make a trivial state store. Useful if you only
 * intend to override some small number of values.
 */
function dummyState(): State {
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
    groupStore: new GroupStore({ markChangesPending }),
    mergeList: ref([]),
    pendingSaveCount: ref(0),
    progress: reactive({ loaded: true }),
    revisionId: ref(0),
    groupStyleManager: new StyleManager({ markChangesPending }),
    selectedKey: ref(''),
    selectedTrackId: ref(null),
    time: {
      frame: ref(0),
      flick: ref(0),
      frameRate: ref(0),
      originalFps: ref(null),
    },
    trackStore: new TrackStore({ markChangesPending }),
    trackStyleManager: new StyleManager({ markChangesPending }),
    visibleModes: ref(['rectangle', 'text'] as VisibleAnnotationTypes[]),
    readOnlyMode: ref(false),
    imageEnhancements: ref({}),
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
  provide(GroupStoreSymbol, state.groupStore);
  provide(GroupStyleManagerSymbol, state.groupStyleManager);
  provide(MergeListSymbol, state.mergeList);
  provide(PendingSaveCountSymbol, state.pendingSaveCount);
  provide(ProgressSymbol, state.progress);
  provide(RevisionIdSymbol, state.revisionId);
  provide(TrackStoreSymbol, state.trackStore);
  provide(TracksSymbol, state.filteredTracks);
  provide(TrackStyleManagerSymbol, state.trackStyleManager);
  provide(SelectedKeySymbol, state.selectedKey);
  provide(SelectedTrackIdSymbol, state.selectedTrackId);
  provide(TimeSymbol, state.time);
  provide(VisibleModesSymbol, state.visibleModes);
  provide(ReadOnlyModeSymbol, state.readOnlyMode);
  provide(ImageEnhancementsSymbol, state.imageEnhancements);
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

function useGroupStore() {
  return use<GroupStore>(GroupStoreSymbol);
}

function useGroupStyleManager() {
  return use<StyleManager>(GroupStyleManagerSymbol);
}

function useHandler() {
  return use<Handler>(HandlerSymbol);
}

function useMergeList() {
  return use<MergeList>(MergeListSymbol);
}

function usePendingSaveCount() {
  return use<pendingSaveCountType>(PendingSaveCountSymbol);
}

function useProgress() {
  return use<ProgressType>(ProgressSymbol);
}

function useRevisionId() {
  return use<RevisionIdType>(RevisionIdSymbol);
}

function useFilteredTracks() {
  return use<FilteredTracksType>(TracksSymbol);
}

function useTrackStyleManager() {
  return use<StyleManager>(TrackStyleManagerSymbol);
}

function useSelectedKey() {
  return use<SelectedKeyType>(SelectedKeySymbol);
}

function useSelectedTrackId() {
  return use<SelectedTrackIdType>(SelectedTrackIdSymbol);
}

function useTime() {
  return use<TimeType>(TimeSymbol);
}

function useTrackStore() {
  return use<TrackStore>(TrackStoreSymbol);
}

function useVisibleModes() {
  return use<VisibleModesType>(VisibleModesSymbol);
}
function useReadOnlyMode() {
  return use<ReadOnylModeType>(ReadOnlyModeSymbol);
}
function useImageEnhancements() {
  return use<ImageEnhancementsType>(ImageEnhancementsSymbol);
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
  useGroupStore,
  useGroupStyleManager,
  useMergeList,
  usePendingSaveCount,
  useProgress,
  useFilteredTracks,
  useRevisionId,
  useTrackStore,
  useTrackStyleManager,
  useSelectedKey,
  useSelectedTrackId,
  useTime,
  useVisibleModes,
  useReadOnlyMode,
  useImageEnhancements,
};
