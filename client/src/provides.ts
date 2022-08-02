import {
  provide, inject, ref, Ref, reactive,
} from '@vue/composition-api';

import type { AnnotatorPreferences as AnnotatorPrefsIface } from './types';
import StyleManager from './StyleManager';
import type { EditAnnotationTypes } from './layers/EditAnnotationLayer';
import type { AnnotationId, StringKeyObject } from './BaseAnnotation';
import type { VisibleAnnotationTypes } from './layers';
import type { RectBounds } from './utils';
import type {
  Attribute,
  AttributeFilter,
  AttributeKeyFilter,
  TimelineAttribute,
} from './use/useAttributes';
import type { Time } from './use/useTimeObserver';
import type { ImageEnhancements } from './use/useImageEnhancements';
import TrackFilterControls from './TrackFilterControls';
import GroupFilterControls from './GroupFilterControls';
import CameraStore from './CameraStore';


/**
 * Type definitions are read only because injectors may mutate internal state,
 * but should never overwrite or delete the injected object.
 */

const AnnotatorPreferencesSymbol = Symbol('annotatorPreferences');
type AnnotatorPreferences = Readonly<Ref<AnnotatorPrefsIface>>;

const AttributesSymbol = Symbol('attributes');
type AttributesType = Readonly<Ref<Attribute[]>>;

const AttributesFilterSymbol = Symbol('attributesFilter');
export interface AttributesFilterType {
  attributeFilters: Readonly<Ref< {track: AttributeFilter[]; detection: AttributeFilter[]}>>;
  addAttributeFilter: (index: number, type: Attribute['belongs'], filter: AttributeFilter) => void;
  modifyAttributeFilter: (index: number, type: Attribute['belongs'], filter: AttributeFilter) => void;
  deleteAttributeFilter: (index: number, type: Attribute['belongs']) => void;
  sortAndFilterAttributes: (attributeList: Attribute[], mode: Attribute['belongs'], attribVals: StringKeyObject, sortingMode: number, filters: AttributeFilter[]) => Attribute[];
  setTimelineEnabled: (val: boolean) => void;
  setTimelineFilter: (filter: AttributeKeyFilter) => void;
  attributeTimelineData: Readonly<Ref<TimelineAttribute[]>>;
  timelineFilter: Readonly<Ref<AttributeKeyFilter>>;
  timelineEnabled: Readonly<Ref<boolean>>;
}

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

const SelectedCameraSymbol = Symbol('selectedCamera');
type SelectedCameraType = Readonly<Ref<string>>;

const SelectedKeySymbol = Symbol('selectedKey');
type SelectedKeyType = Readonly<Ref<string>>;

const SelectedTrackIdSymbol = Symbol('selectedTrackId');
const EditingGroupIdSymbol = Symbol('editingGroupId');
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
const CameraStoreSymbol = Symbol('cameraStore');

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
  removeTrack(AnnotationIds: AnnotationId[],
    forcePromptDisable?: boolean, cameraName?: string): void;
  /* remove a whole group */
  removeGroup(AnnotationIds: AnnotationId[]): void;
  /* Remove a single point from selected track's geometry by selected index */
  removePoint(): void;
  /* Remove an entire annotation from selected track by selected key */
  removeAnnotation(): void;
  /* selectCamera */
  selectCamera(camera: string, editMode: boolean): void;
  /* set selectFeatureHandle and selectedKey */
  selectFeatureHandle(i: number, key: string): void;
  /* set an Attribute in the metaData */
  setAttribute({ data, oldAttribute }:
    { data: Attribute; oldAttribute?: Attribute }, updateAllTracks?: boolean): void;
  /* delete an Attribute in the metaData */
  deleteAttribute({ data }: { data: Attribute }, removeFromTracks?: boolean): void;
  /* Commit the staged merge tracks */
  commitMerge(): void;
  /* Create new group */
  groupAdd(): void;
  /* Put UI into group editing mode */
  groupEdit(id: AnnotationId | null): void;
  /* Turn merge mode on and off */
  toggleMerge(): AnnotationId[];
  /* Remove AnnotationIds from merge */
  unstageFromMerge(ids: AnnotationId[]): void;
  /* Reload Annotation File */
  reloadAnnotations(): Promise<void>;
  setSVGFilters({ blackPoint, whitePoint }: {blackPoint?: number; whitePoint?: number}): void;
  /* unlink Camera Track */
  unlinkCameraTrack(trackId: AnnotationId, camera: string): void;
  /* link Camera Track */
  linkCameraTrack(baseTrackId: AnnotationId, linkTrackId: AnnotationId, camera: string): void;
  startLinking(camera: string): void;
  stopLinking(): void;

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
    trackAdd(...args) { handle('trackAdd', args); return 0; },
    updateRectBounds(...args) { handle('updateRectBounds', args); },
    updateGeoJSON(...args) { handle('updateGeoJSON', args); },
    removeTrack(...args) { handle('removeTrack', args); },
    removeGroup(...args) { handle('removeGroup', args); },
    removePoint(...args) { handle('removePoint', args); },
    removeAnnotation(...args) { handle('removeAnnotation', args); },
    selectCamera(...args) { handle('selectCamera', args); },
    selectFeatureHandle(...args) { handle('selectFeatureHandle', args); },
    setAttribute(...args) { handle('setAttribute', args); },
    deleteAttribute(...args) { handle('deleteAttribute', args); },
    toggleMerge(...args) { handle('toggleMerge', args); return []; },
    commitMerge(...args) { handle('commitMerge', args); },
    groupAdd(...args) { handle('groupAdd', args); },
    groupEdit(...args) { handle('groupEdit', args); },
    unstageFromMerge(...args) { handle('unstageFromMerge', args); },
    reloadAnnotations(...args) { handle('reloadTracks', args); return Promise.resolve(); },
    setSVGFilters(...args) { handle('setSVGFilter', args); },
    unlinkCameraTrack(...args) { handle('unlinkCameraTrack', args); },
    linkCameraTrack(...args) { handle('linkCameraTrack', args); },
    startLinking(...args) { handle('startLinking', args); },
    stopLinking(...args) { handle('stopLinking', args); },

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
  cameraStore: CameraStore;
  datasetId: DatasetIdType;
  editingMode: EditingModeType;
  groupFilters: GroupFilterControls;
  groupStyleManager: StyleManager;
  multiSelectList: MultiSelectType;
  pendingSaveCount: pendingSaveCountType;
  progress: ProgressType;
  revisionId: RevisionIdType;
  selectedCamera: SelectedCameraType;
  selectedKey: SelectedKeyType;
  selectedTrackId: SelectedTrackIdType;
  editingGroupId: SelectedTrackIdType;
  time: TimeType;
  trackFilters: TrackFilterControls;
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
  const cameraStore = new CameraStore({ markChangesPending });
  const groupFilterControls = new GroupFilterControls(
    {
      sorted: cameraStore.sortedGroups,
      remove: cameraStore.removeGroups,
      markChangesPending,
    },
  );
  const trackFilterControls = new TrackFilterControls({
    sorted: cameraStore.sortedTracks,
    remove: cameraStore.removeTracks,
    markChangesPending,
    groupFilterControls,
    lookupGroups: cameraStore.lookupGroups,
  });
  return {
    annotatorPreferences: ref({ trackTails: { before: 20, after: 10 } }),
    attributes: ref([]),
    cameraStore,
    datasetId: ref(''),
    editingMode: ref(false),
    multiSelectList: ref([]),
    pendingSaveCount: ref(0),
    progress: reactive({ loaded: true }),
    revisionId: ref(0),
    groupFilters: groupFilterControls,
    groupStyleManager: new StyleManager({ markChangesPending }),
    selectedCamera: ref('singleCam'),
    selectedKey: ref(''),
    selectedTrackId: ref(null),
    editingGroupId: ref(null),
    time: {
      frame: ref(0),
      flick: ref(0),
      frameRate: ref(0),
      originalFps: ref(null),
    },
    trackFilters: trackFilterControls,
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
 * @param {Handler} handler
 * @param {}
 */
function provideAnnotator(state: State, handler: Handler, attributesFilters: AttributesFilterType) {
  provide(AnnotatorPreferencesSymbol, state.annotatorPreferences);
  provide(AttributesSymbol, state.attributes);
  provide(CameraStoreSymbol, state.cameraStore);
  provide(DatasetIdSymbol, state.datasetId);
  provide(EditingModeSymbol, state.editingMode);
  provide(GroupFilterControlsSymbol, state.groupFilters);
  provide(GroupStyleManagerSymbol, state.groupStyleManager);
  provide(MultiSelectSymbol, state.multiSelectList);
  provide(PendingSaveCountSymbol, state.pendingSaveCount);
  provide(ProgressSymbol, state.progress);
  provide(RevisionIdSymbol, state.revisionId);
  provide(TrackFilterControlsSymbol, state.trackFilters);
  provide(TrackStyleManagerSymbol, state.trackStyleManager);
  provide(SelectedCameraSymbol, state.selectedCamera);
  provide(SelectedKeySymbol, state.selectedKey);
  provide(SelectedTrackIdSymbol, state.selectedTrackId);
  provide(EditingGroupIdSymbol, state.editingGroupId);
  provide(TimeSymbol, state.time);
  provide(VisibleModesSymbol, state.visibleModes);
  provide(ReadOnlyModeSymbol, state.readOnlyMode);
  provide(ImageEnhancementsSymbol, state.imageEnhancements);
  provide(HandlerSymbol, handler);
  provide(AttributesFilterSymbol, attributesFilters);
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

function useAttributesFilters() {
  return use<AttributesFilterType>(AttributesFilterSymbol);
}

function useCameraStore() {
  return use<CameraStore>(CameraStoreSymbol);
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

function useSelectedCamera() {
  return use<SelectedCameraType>(SelectedCameraSymbol);
}


function useSelectedKey() {
  return use<SelectedKeyType>(SelectedKeySymbol);
}

function useSelectedTrackId() {
  return use<SelectedTrackIdType>(SelectedTrackIdSymbol);
}

function useEditingGroupId() {
  return use<SelectedTrackIdType>(EditingGroupIdSymbol);
}

function useTime() {
  return use<TimeType>(TimeSymbol);
}

function useTrackFilters() {
  return use<TrackFilterControls>(TrackFilterControlsSymbol);
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
  useCameraStore,
  useDatasetId,
  useEditingMode,
  useHandler,
  useGroupFilterControls,
  useGroupStyleManager,
  useMultiSelectList,
  usePendingSaveCount,
  useProgress,
  useRevisionId,
  useTrackFilters,
  useTrackStyleManager,
  useSelectedCamera,
  useSelectedKey,
  useSelectedTrackId,
  useEditingGroupId,
  useTime,
  useVisibleModes,
  useReadOnlyMode,
  useImageEnhancements,
  useAttributesFilters,
};
