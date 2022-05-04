import {
  provide, inject, ref, Ref, reactive,
} from '@vue/composition-api';

import { AnnotatorPreferences as AnnotatorPrefsIface } from './types';
import StyleManager from './StyleManager';
import { EditAnnotationTypes } from './layers/EditAnnotationLayer';
import TrackStore from './TrackStore';
import GroupStore from './GroupStore';
import type { AnnotationId } from './BaseAnnotation';
import { VisibleAnnotationTypes } from './layers';
import { RectBounds } from './utils';
import { Attribute } from './use/useAttributes';
import { Time } from './use/useTimeObserver';
import { ImageEnhancements } from './use/useImageEnhancements';
import TrackFilterControls from './TrackFilterControls';
import GroupFilterControls from './GroupFilterControls';

/**
 * Type definitions are read only because injectors may mutate internal state,
 * but should never overwrite or delete the injected object.
 */

const AnnotatorPreferencesSymbol = Symbol('annotatorPreferences');
type AnnotatorPreferences = Readonly<Ref<AnnotatorPrefsIface>>;

const AttributesSymbol = Symbol('attributes');
type AttributesType = Readonly<Ref<Attribute[]>>;

const DatasetIdSymbol = Symbol('datasetID');
type DatasetIdType = Readonly<Ref<string>>;

const EditingModeSymbol = Symbol('editingMode');
type EditingModeType = Readonly<Ref<false | EditAnnotationTypes>>;

const MultiSelectSymbol = Symbol('multiSelect');
type MultiSelectType = Readonly<Ref<readonly AnnotationId[]>>;

const PendingSaveCountSymbol = Symbol('pendingSaveCount');
type pendingSaveCountType = Readonly<Ref<number>>;

const ProgressSymbol = Symbol('progress');
type ProgressType = Readonly<{ loaded: boolean }>;

const RevisionIdSymbol = Symbol('revisionId');
type RevisionIdType = Readonly<Ref<number>>;

const SelectedKeySymbol = Symbol('selectedKey');
type SelectedKeyType = Readonly<Ref<string>>;

const SelectedTrackIdSymbol = Symbol('selectedTrackId');
const SelectedGroupIdSymbol = Symbol('selectedGroupId');
type SelectedTrackIdType = Readonly<Ref<AnnotationId | null>>;

const TimeSymbol = Symbol('time');
type TimeType = Readonly<Time>;

const VisibleModesSymbol = Symbol('visibleModes');
type VisibleModesType = Readonly<Ref<readonly VisibleAnnotationTypes[]>>;

const ReadOnlyModeSymbol = Symbol('readOnlyMode');
type ReadOnylModeType = Readonly<Ref<boolean>>;

const ImageEnhancementsSymbol = Symbol('imageEnhancements');
type ImageEnhancementsType = Readonly<Ref<ImageEnhancements>>;

/** Class-based symbols */

const GroupStoreSymbol = Symbol('groupStore');
const TrackStoreSymbol = Symbol('trackStore');

const TrackStyleManagerSymbol = Symbol('trackTypeStyling');
const GroupStyleManagerSymbol = Symbol('groupTypeStyling');

const TrackFilterControlsSymbol = Symbol('trackFilters');
const GroupFilterControlsSymbol = Symbol('groupFilters');

/**
 * Handler interface describes all global events mutations
 * for above state
 */
export interface Handler {
  /* Save pending changes to persistence layer */
  save(): Promise<void>;
  /* Select and seek to track */
  trackSeek(AnnotationId: AnnotationId): void;
  /* Toggle editing mode for track */
  trackEdit(AnnotationId: AnnotationId): void;
  /* toggle selection mode for track */
  trackSelect(AnnotationId: AnnotationId | null, edit: boolean): void;
  /* select next track in the list */
  trackSelectNext(delta: number): void;
  /* split track */
  trackSplit(AnnotationId: AnnotationId | null, frame: number): void;
  /* Change tracks difinitive type */
  trackTypeChange(AnnotationId: AnnotationId | null, value: string): void;
  /* Add new empty track and select it */
  trackAdd(): AnnotationId;
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
  removeTrack(AnnotationIds: AnnotationId[], forcePromptDisable?: boolean): void;
  /* Remove a single point from selected track's geometry by selected index */
  removePoint(): void;
  /* Remove an entire annotation from selected track by selected key */
  removeAnnotation(): void;
  /* set selectFeatureHandle and selectedKey */
  selectFeatureHandle(i: number, key: string): void;
  /* set an Attribute in the metaData */
  setAttribute({ data, oldAttribute }:
    { data: Attribute; oldAttribute?: Attribute }, updateAllTracks?: boolean): void;
  /* delete an Attribute in the metaData */
  deleteAttribute({ data }: { data: Attribute }, removeFromTracks?: boolean): void;
  /* Commit the staged merge tracks */
  commitMerge(): void;
  /* Create new group from multi-select */
  commitGroup(): void;
  /* Turn merge mode on and off */
  toggleMerge(): AnnotationId[];
  /* Remove AnnotationIds from merge */
  unstageFromMerge(ids: AnnotationId[]): void;
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
    setAttribute(...args) { handle('setAttribute', args); },
    deleteAttribute(...args) { handle('deleteAttribute', args); },
    toggleMerge(...args) { handle('toggleMerge', args); return []; },
    commitMerge(...args) { handle('commitMerge', args); },
    commitGroup(...args) { handle('commitGroup', args); },
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
  datasetId: DatasetIdType;
  editingMode: EditingModeType;
  groupFilters: GroupFilterControls;
  groupStore: GroupStore;
  groupStyleManager: StyleManager;
  multiSelectList: MultiSelectType;
  pendingSaveCount: pendingSaveCountType;
  progress: ProgressType;
  revisionId: RevisionIdType;
  selectedKey: SelectedKeyType;
  selectedTrackId: SelectedTrackIdType;
  selectedGroupId: SelectedTrackIdType;
  time: TimeType;
  trackFilters: TrackFilterControls;
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
  const trackStore = new TrackStore({ markChangesPending });
  const groupStore = new GroupStore({ markChangesPending });
  const groupFilterControls = new GroupFilterControls({ store: groupStore, markChangesPending });
  const trackFilterControls = new TrackFilterControls({
    store: trackStore, markChangesPending, groupFilterControls, groupStore,
  });
  return {
    annotatorPreferences: ref({ trackTails: { before: 20, after: 10 } }),
    attributes: ref([]),
    datasetId: ref(''),
    editingMode: ref(false),
    groupStore,
    multiSelectList: ref([]),
    pendingSaveCount: ref(0),
    progress: reactive({ loaded: true }),
    revisionId: ref(0),
    groupFilters: groupFilterControls,
    groupStyleManager: new StyleManager({ markChangesPending }),
    selectedKey: ref(''),
    selectedTrackId: ref(null),
    selectedGroupId: ref(null),
    time: {
      frame: ref(0),
      flick: ref(0),
      frameRate: ref(0),
      originalFps: ref(null),
    },
    trackFilters: trackFilterControls,
    trackStore,
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
  provide(DatasetIdSymbol, state.datasetId);
  provide(EditingModeSymbol, state.editingMode);
  provide(GroupFilterControlsSymbol, state.groupFilters);
  provide(GroupStoreSymbol, state.groupStore);
  provide(GroupStyleManagerSymbol, state.groupStyleManager);
  provide(MultiSelectSymbol, state.multiSelectList);
  provide(PendingSaveCountSymbol, state.pendingSaveCount);
  provide(ProgressSymbol, state.progress);
  provide(RevisionIdSymbol, state.revisionId);
  provide(TrackFilterControlsSymbol, state.trackFilters);
  provide(TrackStoreSymbol, state.trackStore);
  provide(TrackStyleManagerSymbol, state.trackStyleManager);
  provide(SelectedKeySymbol, state.selectedKey);
  provide(SelectedTrackIdSymbol, state.selectedTrackId);
  provide(SelectedGroupIdSymbol, state.selectedGroupId);
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

function useDatasetId() {
  return use<DatasetIdType>(DatasetIdSymbol);
}

function useEditingMode() {
  return use<EditingModeType>(EditingModeSymbol);
}

function useGroupFilterControls() {
  return use<GroupFilterControls>(GroupFilterControlsSymbol);
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

function useMultiSelectList() {
  return use<MultiSelectType>(MultiSelectSymbol);
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

function useTrackStyleManager() {
  return use<StyleManager>(TrackStyleManagerSymbol);
}

function useSelectedKey() {
  return use<SelectedKeyType>(SelectedKeySymbol);
}

function useSelectedTrackId() {
  return use<SelectedTrackIdType>(SelectedTrackIdSymbol);
}

function useSelectedGroupId() {
  return use<SelectedTrackIdType>(SelectedGroupIdSymbol);
}

function useTime() {
  return use<TimeType>(TimeSymbol);
}

function useTrackFilters() {
  return use<TrackFilterControls>(TrackFilterControlsSymbol);
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
  useDatasetId,
  useEditingMode,
  useHandler,
  useGroupFilterControls,
  useGroupStore,
  useGroupStyleManager,
  useMultiSelectList,
  usePendingSaveCount,
  useProgress,
  useRevisionId,
  useTrackFilters,
  useTrackStore,
  useTrackStyleManager,
  useSelectedKey,
  useSelectedTrackId,
  useSelectedGroupId,
  useTime,
  useVisibleModes,
  useReadOnlyMode,
  useImageEnhancements,
};
