import IntervalTree from '@flatten-js/interval-tree';
import { provide, inject, Ref } from '@vue/composition-api';
import { EditAnnotationTypes } from './layers/EditAnnotationLayer';
import Track, { TrackId } from './track';
import { TypeStyling } from './use/useStyling';
import { StateStyles } from 'vue-media-annotator/use/useStyling';

/**
 * Provides declares the dependencies that a consumer must provide before
 * constructing an AnnotationLayer of any kind
 */

/**
 * Type definitions are read only because injectors may mutate internal state,
 * but should never overwrite or delete the injected object.
 */

const AllTypesSymbol = Symbol('allTypes');
type AllTypesType = Readonly<Ref<readonly string[]>>;

const CheckedTrackIdsSymbol = Symbol('checkedTrackIds');
type CheckedTrackIdsType = Readonly<Ref<readonly TrackId[]>>;

const CheckedTypesSymbol = Symbol('checkedTypes');
type CheckedTypesType = Readonly<Ref<readonly string[]>>;

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
  frame: FrameType,
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

function useEditingMode() {
  return _use<EditingModeType>(EditingModeSymbol);
}

function useFrame() {
  return _use<FrameType>(FrameSymbol);
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
  /*
  AllTypesSymbol,
  CheckedTrackIdsSymbol,
  CheckedTypesSymbol,
  EditingModeSymbol,
  FrameSymbol,
  TrackMapSymbol,
  TracksSymbol,
  TypeStylingSymbol,
  SelectedKeySymbol,
  SelectedTrackIdSymbol,
  VisibleModesSymbol,
  */
  provideAnnotator,
  useAllTypes,
  useCheckedTrackIds,
  useCheckedTypes,
  useEditingMode,
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
