import {
  computed, Ref, reactive, ref,
} from '@vue/composition-api';
import { cloneDeep, uniq, flatMapDeep } from 'lodash';
import Track, { TrackId, Feature } from 'vue-media-annotator/track';
import {
  RectBounds, findBounds, removePoint, updateBounds,
} from 'vue-media-annotator/utils';
import { EditAnnotationTypes } from 'vue-media-annotator/layers/EditAnnotationLayer';

import Recipe from 'vue-media-annotator/recipe';
import { NewTrackSettings } from './useSettings';

export interface Annotator {
  seek(frame: number): void;
  resetZoom(): void;
  nextFrame(): void;
}


/**
 * The point of this composition function is to define and manage the transition betwee
 * different UI states within the program.  States and state transitions can be modified
 * based on settings, blocked if it tries to go to incompatible state or provide feedback
 *
 * Mostly allows us to inject additional logic into transitions.
 */
export default function useModeManager({
  selectedTrackId,
  editingTrack,
  frame,
  trackMap,
  playbackComponent,
  newTrackSettings,
  selectTrack,
  getTrack,
  selectNextTrack,
  addTrack,
  removeTrack,
  // removeHeadTails,
  // updateHeadTails,
}: {
  selectedTrackId: Ref<TrackId | null>;
  editingTrack: Ref<boolean>;
  frame: Ref<number>;
  trackMap: Map<TrackId, Track>;
  playbackComponent: Ref<Annotator>;
  newTrackSettings: NewTrackSettings;
  selectTrack: (trackId: TrackId | null, edit: boolean) => void;
  getTrack: (trackId: TrackId) => Track;
  selectNextTrack: (delta?: number) => TrackId | null;
  addTrack: (frame: number, defaultType: string) => Track;
  removeTrack: (trackId: TrackId) => void;
  // removeHeadTails: (frameNum: number, track: Track, index: number) => void;
  // updateHeadTails: (
  //   frameNum: number,
  //   track: Track,
  //   interpolate: boolean,
  //   key: string,
  //   data: GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>,
  // ) => void;
}) {
  let newTrackMode = false;
  let newDetectionMode = false;

  const recipes: Recipe[] = [];
  const annotationModes = reactive({
    visible: ['rectangle', 'Polygon', 'LineString'] as EditAnnotationTypes[],
    editing: 'rectangle' as EditAnnotationTypes,
  });
  // selectedFeatureHandle could arguably belong in useTrackSelectionControls,
  // but the meaning of this value varies based on the editing mode.  When in
  // polygon edit mode, this corresponds to a polygon point.  Ditto in line mode.
  const selectedFeatureHandle = ref(-1);
  //The Key of the selected type, for now mostly ''
  const selectedKey = ref('');
  // which type is currently being edited, if any
  const editingMode = computed(() => editingTrack.value && annotationModes.editing);
  // which types are currently visible, always including the editingType
  const visibleModes = computed(() => (
    uniq(annotationModes.visible.concat(editingMode.value || []))
  ));

  function addRecipe(r: Recipe) {
    recipes.push(r);
  }

  /**
   * Figure out if a new feature should enable interpolation
   * based on current state and the result of canInterolate.
   */
  function _shouldInterpolate(interpolate: boolean) {
    const interpolateTrack = newTrackMode
      ? newTrackSettings.modeSettings.Track.interpolate
      : interpolate;
    return (newDetectionMode && !newTrackMode)
      ? false
      : interpolateTrack;
  }

  function seekNearest(track: Track) {
    // Seek to the nearest point in the track.
    if (frame.value < track.begin) {
      playbackComponent.value.seek(track.begin);
    } else if (frame.value > track.end) {
      playbackComponent.value.seek(track.end);
    }
  }

  function _selectKey(key: string | '') {
    selectedKey.value = key;
  }

  function handleSelectFeatureHandle(i: number, key = '') {
    selectedFeatureHandle.value = i;
    if (key !== '') {
      _selectKey(key);
    }
  }

  function handleSelectTrack(trackId: TrackId | null, edit = false) {
    selectTrack(trackId, edit);
    if (newTrackMode && !edit) {
      newTrackMode = false;
    }
  }

  function handleAddTrack() {
    // Handles adding a new track with the NewTrack Settings
    selectTrack(addTrack(frame.value, newTrackSettings.type).trackId, true);
    newTrackMode = true;
  }

  function handleTrackTypeChange({ trackId, value }: { trackId: TrackId; value: string }) {
    getTrack(trackId).setType(value);
  }

  function newTrackSettingsAfterLogic(addedTrack: Track) {
    // Default settings which are updated by the CreationMode component
    // Not making them reactive, and eventually will probably be in localStorage
    if (addedTrack && newTrackSettings !== null) {
      if (newTrackSettings.mode === 'Track' && newTrackSettings.modeSettings.Track.autoAdvanceFrame) {
        playbackComponent.value.nextFrame();
      } else if (newTrackSettings.mode === 'Detection') {
        if (newTrackSettings.modeSettings.Detection.continuous) {
          handleAddTrack();
        } else { //Exit editing mode for the added track
          selectTrack(addedTrack.trackId, false);
        }
      }
    }
  }

  function handleUpdateRectBounds(frameNum: number, bounds: RectBounds) {
    if (selectedTrackId.value !== null) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        // Determines if we are creating a new Detection
        const { features, interpolate } = track.canInterpolate(frameNum);
        const [real] = features;
        if (!real || real.bounds === undefined) {
          newDetectionMode = true;
        }
        track.setFeature({
          frame: frameNum,
          bounds,
          keyframe: true,
          interpolate: _shouldInterpolate(interpolate),
        });
        //If it is a new track and we have newTrack Settings
        if (newTrackMode && newDetectionMode) {
          newTrackSettingsAfterLogic(track);
        }
        newDetectionMode = false;
      }
    }
  }

  function _updateTrackFeature(
    frameNum: number,
    real: Feature | null,
    data: Record<string, GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>[]>,
    track: Track,
    interpolate: boolean,
  ) {
    //Update bounds based on type and condition of the updated bounds
    // let oldBounds;
    // if (real) {
    //   oldBounds = real.bounds;
    // }

    // TODO: figure out how to handle multiple data
    // const newbounds = findBounds(data[0]);
    // const updatedBounds = updateBounds(oldBounds, newbounds, data[0]);

    const feature = {
      frame: frameNum,
      keyframe: true,
      // bounds: updatedBounds,
      interpolate,
    };
    // flatten the { key: geom[] } argument into a geom array.
    const newFeatureGeometry = flatMapDeep(data,
      (geomlist, key) => geomlist.map((geom) => ({
        type: geom.type,
        geometry: geom.geometry,
        properties: { key },
      })));
    console.log(newFeatureGeometry);
    // TODO: update to only work with polygon changes, not line changes
    track.setFeature(feature, newFeatureGeometry);
  }

  // function _recipeCallback(args: RecipeUpdateCallbackArgs) {
  //   if (args.newMode) selectTrack(selectedTrackId.value, args.newMode === 'editing');
  //   if (args.newSelectedKey) selectedKey.value = args.newSelectedKey;
  //   if (args.newType) annotationModes.editing = args.newType;
  // }


  function handleUpdateInProgressGeoJSON(
    frameNum: number,
    data: GeoJSON.LineString | GeoJSON.Polygon,
  ) {
    if (!selectedTrackId.value) return;
    const track = trackMap.get(selectedTrackId.value);
    if (!track) return;
    for (let i = 0; i < recipes.length; i += 1) {
      const recipe = recipes[i];
      const update = recipe.update(frameNum, track, selectedKey.value, data);
      if (update.data !== null) {
        const { features, interpolate } = track.canInterpolate(frameNum);
        const [real] = features;
        // TODO real
        _updateTrackFeature(
          frameNum, real, update.data,
          track, _shouldInterpolate(interpolate),
        );
        if (update.newMode) selectTrack(selectedTrackId.value, update.newMode === 'editing');
        if (update.newSelectedKey) selectedKey.value = update.newSelectedKey;
        if (update.newType) annotationModes.editing = update.newType;
        // TODO for now, only one recipe will be active at a time.
        break;
      }
    }
  }

  // //Creation of head or tail points
  // function handleFeaturePointing(key: 'head' | 'tail') {
  //   if (selectedTrackId.value !== null) {
  //     handleSelectKey(key);
  //     annotationModes.editing = 'Point';
  //     selectTrack(selectedTrackId.value, true);
  //   }
  // }

  // const headTailReservedKeys = ['head', 'tail', 'HeadTails'];

  function handleUpdateGeoJSON(
    frameNum: number,
    data: GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>,
    key: string,
  ) {
    if (selectedTrackId.value !== null) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        // Determines if we are creating a new Detection
        const { features, interpolate } = track.canInterpolate(frameNum);
        const [real] = features;
        if (!real || real.bounds === undefined) {
          newDetectionMode = true;
        }
        _updateTrackFeature(
          frameNum, real, { [key]: [data] }, track,
          _shouldInterpolate(interpolate),
        );
        //If we are creating a point, we swap back to rectangle once done
        //we also check if we need to make the line
        if (data.geometry.type === 'Point' && annotationModes.editing === 'Point') {
          _selectKey('');
          annotationModes.editing = 'rectangle';
          selectTrack(selectedTrackId.value, false);
        }
        //If it is a new track and we have newTrack Settings
        if (newTrackMode && newDetectionMode) {
          newTrackSettingsAfterLogic(track);
        }
        newDetectionMode = false;
      }
    }
  }

  /**
   * Removes the selectedIndex point for the selected Polygon/line
   */
  function handleRemovePoint(type: '' | GeoJSON.GeoJsonGeometryTypes = '') {
    if (selectedTrackId.value !== null && selectedFeatureHandle.value !== -1) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        // Determines if we are creating a new Detection
        const { features } = track.canInterpolate(frame.value);
        const [real] = features;
        if (!real) return;
        const geoJSONType = type !== '' ? type : annotationModes.editing;
        const geoJsonFeatures = track.getFeatureGeometry(frame.value, {
          type: geoJSONType,
          key: selectedKey.value,
        });
        if (geoJsonFeatures.length === 0) return;
        //could operate directly on the polygon memory, but small enough to copy and edit
        const clone = cloneDeep(geoJsonFeatures[0]);
        // if (selectedKey.value === 'HeadTails') {
        //   removeHeadTails(frame.value, track, selectedFeatureHandle.value);
        //   handleSelectFeatureHandle(-1);
        if (removePoint(clone, selectedFeatureHandle.value)) {
          track.setFeature({
            frame: frame.value,
            bounds: findBounds(clone),
          }, [clone]);
          handleSelectFeatureHandle(-1);
        }
      }
    }
  }

  function handleRemoveAnnotation(frameNum: number, key = '', type: '' | GeoJSON.GeoJsonGeometryTypes) {
    if (selectedTrackId.value !== null && selectedFeatureHandle.value !== -1) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        // Determines if we are creating a new Detection
        const { features } = track.canInterpolate(frame.value);
        const [real] = features;
        if (!real) return false;
        // TODO: This can be changed when we have selection of annotations by key/type
        const geoJSONType = type !== '' ? type : annotationModes.editing;
        track.removeFeatureGeometry(frameNum, { key, type: geoJSONType });
        return true;
      }
    }
    return false;
  }

  function handleRemoveTrack(trackId: TrackId) {
    // if removed track was selected, unselect before remove
    if (selectedTrackId.value === trackId) {
      const newTrack = selectNextTrack(1) !== null ? selectNextTrack(1) : selectNextTrack(-1);
      selectTrack(newTrack, false);
    }
    removeTrack(trackId);
  }

  /** Toggle editing mode for track */
  function handleTrackEdit(trackId: TrackId) {
    const track = getTrack(trackId);
    seekNearest(track);
    selectTrack(trackId, trackId === selectedTrackId.value ? (!editingTrack.value) : true);
  }

  function handleTrackClick(trackId: TrackId) {
    const track = getTrack(trackId);
    seekNearest(track);
    selectTrack(trackId, editingTrack.value);
  }

  function handleSelectNext(delta: number) {
    const newTrack = selectNextTrack(delta);
    if (newTrack !== null) {
      selectTrack(newTrack, false);
      seekNearest(getTrack(newTrack));
    }
  }

  function handleSetAnnotationState({ visible, editing, key }: {
    visible?: EditAnnotationTypes[];
    editing?: EditAnnotationTypes;
    key: string;
  }) {
    if (visible) annotationModes.visible = visible;
    if (editing) {
      annotationModes.editing = editing;
      if (key) _selectKey(key);
      selectTrack(selectedTrackId.value, !!selectedTrackId.value);
    }
  }

  return {
    editingMode,
    visibleModes,
    selectedFeatureHandle,
    selectedKey,
    addRecipe,
    handler: {
      selectTrack: handleSelectTrack,
      trackEdit: handleTrackEdit,
      trackTypeChange: handleTrackTypeChange,
      addTrack: handleAddTrack,
      updateRectBounds: handleUpdateRectBounds,
      updateGeoJSON: handleUpdateGeoJSON,
      updateInProgressGeoJSON: handleUpdateInProgressGeoJSON,
      selectNext: handleSelectNext,
      trackClick: handleTrackClick,
      removeTrack: handleRemoveTrack,
      removePoint: handleRemovePoint,
      removeAnnotation: handleRemoveAnnotation,
      selectFeatureHandle: handleSelectFeatureHandle,
      setAnnotationState: handleSetAnnotationState,
    },
  };
}
