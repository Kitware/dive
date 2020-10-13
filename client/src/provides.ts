import IntervalTree from '@flatten-js/interval-tree';
import { provide, inject, Ref } from '@vue/composition-api';

import { StateStyles, TypeStyling } from './use/useStyling';
import { EditAnnotationTypes } from './layers/EditAnnotationLayer';
import Track, { TrackId } from './track';
import { RectBounds } from './utils';

/**
 * Provides declares the dependencies that a consumer must provide before
 * constructing an AnnotationLayer of any kind
 *
 * Type definitions are read only because injectors may mutate internal state,
 * but should never overwrite or delete the injected object.
 */

const AllTypesSymbol = Symbol('allTypes');
type AllTypesType = Readonly<Ref<readonly string[]>>;

const CheckedTrackIdsSymbol = Symbol('checkedTrackIds');
type CheckedTrackIdsType = Readonly<Ref<readonly TrackId[]>>;

const CheckedTypesSymbol = Symbol('checkedTypes');
type CheckedTypesType = Readonly<Ref<readonly string[]>>;

const EnabledTracksSymbol = Symbol('enabledTracks');
type EnabledTracksType = Readonly<Ref<readonly Track[]>>;

const EditingModeSymbol = Symbol('editingMode');
type EditingModeType = Readonly<Ref<false | EditAnnotationTypes>>;

const FrameSymbol = Symbol('frame');
type FrameType = Readonly<Ref<number>>;

const IntervalTreeSymbol = Symbol('intervalTree');
type IntervalTreeType = Readonly<IntervalTree>;

const TrackMapSymbol = Symbol('trackMap');
type TrackMapType = Readonly<Map<TrackId, Track>>;

const TracksSymbol = Symbol('tracks');
type TracksType = Readonly<Ref<readonly Track[]>>;

const TypeStylingSymbol = Symbol('typeStyling');
type TypeStylingType = Readonly<Ref<TypeStyling>>;

const SelectedKeySymbol = Symbol('selectedKey');
type SelectedKeyType = Readonly<Ref<string>>;

const SelectedTrackIdSymbol = Symbol('selectedTrackId');
type SelectedTrackIdType = Readonly<Ref<TrackId | null>>;

const StateStylesSymbol = Symbol('stateStyles');
type StateStylesType = Readonly<StateStyles>;

const VisibleModesSymbol = Symbol('visibleModes');
type VisibleModesType = Readonly<Ref<readonly EditAnnotationTypes[]>>;

/**
 * Handler interface describes all global events mutations
 * for above state
 */
export interface Handler {
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
    bounds: RectBounds,
  ): void;
  /* update geojson for track */
  updateGeoJSON(
    eventType: 'in-progress' | 'editing',
    frameNum: number,
    data: GeoJSON.Feature,
    key?: string,
    preventInterrupt?: () => void,
  ): void;
  /* Remove a whole track */
  removeTrack(trackId: (TrackId | null)): void;
  /* Remove a single point from selected track's geometry by selected index */
  removePoint(): void;
  /* Remove an entire annotation from selected track by selected key */
  removeAnnotation(): void;
  /* set selectFeatureHandle and selectedKey */
  selectFeatureHandle(i: number, key: string): void;
  /* set checked type strings */
  setCheckedTypes(types: string[]): void;
  /* Change type name */
  updateTypeName({ currentType, newType }: { currentType: string; newType: string }): void;
  /* change styles */
  updateTypeStyle(args: {
    type: string;
    color?: string;
    strokeWidth?: number;
    opacity?: number;
    fill?: boolean;
  }): void;
}
const HandlerSymbol = Symbol('handler');

function _handleMissing(s: symbol): Error {
  return new Error(`Missing provided object for symbol ${s.toString()}: must provideAnnotator()`);
}

function _use<T>(s: symbol) {
  const v = inject<T>(s);
  if (v === undefined) {
    throw _handleMissing(s);
  }
  return v;
}

function provideAnnotator(
  allTypes: AllTypesType,
  checkedTrackIds: CheckedTrackIdsType,
  checkedTypes: CheckedTypesType,
  editingMode: EditingModeType,
  enabledTracks: EnabledTracksType,
  frame: FrameType,
  handler: Handler,
  intervalTree: IntervalTreeType,
  trackMap: TrackMapType,
  tracks: TracksType,
  typeStyling: TypeStylingType,
  selectedKey: SelectedKeyType,
  selectedTrackId: SelectedTrackIdType,
  stateStyles: StateStylesType,
  visibleModes: VisibleModesType,
) {
  provide(AllTypesSymbol, allTypes);
  provide(CheckedTrackIdsSymbol, checkedTrackIds);
  provide(CheckedTypesSymbol, checkedTypes);
  provide(EnabledTracksSymbol, enabledTracks);
  provide(EditingModeSymbol, editingMode);
  provide(FrameSymbol, frame);
  provide(IntervalTreeSymbol, intervalTree);
  provide(TrackMapSymbol, trackMap);
  provide(TracksSymbol, tracks);
  provide(TypeStylingSymbol, typeStyling);
  provide(SelectedKeySymbol, selectedKey);
  provide(SelectedTrackIdSymbol, selectedTrackId);
  provide(StateStylesSymbol, stateStyles);
  provide(VisibleModesSymbol, visibleModes);
  provide(HandlerSymbol, handler);
}

function useAllTypes() {
  return _use<AllTypesType>(AllTypesSymbol);
}

function useCheckedTrackIds() {
  return _use<CheckedTrackIdsType>(CheckedTrackIdsSymbol);
}

function useCheckedTypes() {
  return _use<CheckedTypesType>(CheckedTypesSymbol);
}

function useEnabledTracks() {
  return _use<EnabledTracksType>(EnabledTracksSymbol);
}

function useEditingMode() {
  return _use<EditingModeType>(EditingModeSymbol);
}

function useFrame() {
  return _use<FrameType>(FrameSymbol);
}

function useHandler() {
  return _use<Handler>(HandlerSymbol);
}

function useIntervalTree() {
  return _use<IntervalTreeType>(IntervalTreeSymbol);
}

function useTrackMap() {
  return _use<TrackMapType>(TrackMapSymbol);
}

function useTracks() {
  return _use<TracksType>(TracksSymbol);
}

function useTypeStyling() {
  return _use<TypeStylingType>(TypeStylingSymbol);
}

function useSelectedKey() {
  return _use<SelectedKeyType>(SelectedKeySymbol);
}

function useSelectedTrackId() {
  return _use<SelectedTrackIdType>(SelectedTrackIdSymbol);
}

function useStateStyles() {
  return _use<StateStylesType>(StateStylesSymbol);
}

function useVisibleModes() {
  return _use<VisibleModesType>(VisibleModesSymbol);
}

export {
  provideAnnotator,
  useAllTypes,
  useCheckedTrackIds,
  useCheckedTypes,
  useEnabledTracks,
  useEditingMode,
  useHandler,
  useIntervalTree,
  useFrame,
  useTrackMap,
  useTracks,
  useTypeStyling,
  useSelectedKey,
  useSelectedTrackId,
  useStateStyles,
  useVisibleModes,
};
