import {
  computed, Ref, reactive, ref, onBeforeUnmount,
} from '@vue/composition-api';
import { cloneDeep, uniq, flatMapDeep } from 'lodash';
import Track, { TrackId, Feature } from 'vue-media-annotator/track';
import {
  RectBounds, removePoint, updateBounds,
} from 'vue-media-annotator/utils';
import { EditAnnotationTypes } from 'vue-media-annotator/layers/EditAnnotationLayer';

import Recipe from 'vue-media-annotator/recipe';
import { NewTrackSettings } from './useSettings';

type SupportedFeature = GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>;
export interface Annotator {
  seek(frame: number): void;
  resetZoom(): void;
  nextFrame(): void;
}

interface SetAnnotationStateArgs {
  visible?: EditAnnotationTypes[];
  editing?: EditAnnotationTypes;
  key?: string;
  recipeName?: string;
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
  recipes,
  selectTrack,
  getTrack,
  selectNextTrack,
  addTrack,
  removeTrack,
}: {
  selectedTrackId: Ref<TrackId | null>;
  editingTrack: Ref<boolean>;
  frame: Ref<number>;
  trackMap: Map<TrackId, Track>;
  playbackComponent: Ref<Annotator>;
  newTrackSettings: NewTrackSettings;
  recipes: Recipe[];
  selectTrack: (trackId: TrackId | null, edit: boolean) => void;
  getTrack: (trackId: TrackId) => Track;
  selectNextTrack: (delta?: number) => TrackId | null;
  addTrack: (frame: number, defaultType: string) => Track;
  removeTrack: (trackId: TrackId) => void;
}) {
  let newTrackMode = false;
  let newDetectionMode = false;

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

  function _selectKey(key: string | undefined) {
    if (typeof key === 'string') {
      selectedKey.value = key;
    } else {
      selectedKey.value = '';
    }
  }

  function handleSelectFeatureHandle(i: number, key = '') {
    selectedFeatureHandle.value = i;
    _selectKey(key);
  }

  function handleSelectTrack(trackId: TrackId | null, edit = false) {
    selectTrack(trackId, edit);
    if (newTrackMode && !edit) {
      newTrackMode = false;
    }
    // TODO remove this hack when full linestring support is added.
    // if (edit && annotationModes.editing === 'LineString') {
    //   annotationModes.editing = 'rectangle';
    // }
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

  function handleUpdateGeoJSON(
    eventType: 'in-progress' | 'editing',
    frameNum: number,
    // Type alias this
    data: SupportedFeature,
    key?: string,
    preventInterrupt?: () => void,
  ) {
    /**
     * Declare aggregate update collector. Each recipe
     * will have the opportunity to modify this object.
     */
    const update = {
      // Geometry data to be applied to the feature
      geoJsonFeatureRecord: {} as Record<string, SupportedFeature[]>,
      // Ploygons to be unioned with existing bounds (update)
      union: [] as GeoJSON.Polygon[],
      // Polygons to be unioned without existing bounds (overwrite)
      unionWithoutBounds: [] as GeoJSON.Polygon[],
      // If the editor mode should change types
      newType: undefined as EditAnnotationTypes | undefined,
      // If the selected key should change
      newSelectedKey: undefined as string | undefined,
    };

    if (selectedTrackId.value !== null) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        // newDetectionMode is true if there's no keyframe on frameNum
        const { features, interpolate } = track.canInterpolate(frameNum);
        const [real] = features;
        if (!real || real.bounds === undefined) {
          newDetectionMode = true;
        }

        // Give each recipe the opportunity to make changes
        recipes.forEach((recipe) => {
          const changes = recipe.update(eventType, frameNum, track, [data], key);
          // Prevent key conflicts among recipes
          Object.keys(changes.data).forEach((key_) => {
            if (key_ in update.geoJsonFeatureRecord) {
              throw new Error(`Recipe ${recipe.name} tried to overwrite key ${key_} when it was already set`);
            }
          });
          Object.assign(update.geoJsonFeatureRecord, changes.data);
          // Collect unions
          update.union.push(...changes.union);
          update.unionWithoutBounds.push(...changes.unionWithoutBounds);
          // Prevent more than 1 recipe from changing a given mode/key
          if (changes.newType) {
            if (update.newType) {
              throw new Error(`Recipe ${recipe.name} tried to modify type when it was already set`);
            }
            update.newType = changes.newType;
          }
          if (changes.newSelectedKey) {
            if (update.newSelectedKey) {
              throw new Error(`Recipe ${recipe.name} tried to modify selectedKey when it was already set`);
            }
            update.newSelectedKey = changes.newSelectedKey;
          }
        });

        // somethingChanged indicates whether there will need to be a redraw
        // of the geometry currently displayed
        const somethingChanged = (
          update.union.length !== 0
          || update.unionWithoutBounds.length !== 0
          || Object.keys(update.geoJsonFeatureRecord).length !== 0
        );

        // If a drawable changed, but we aren't changing modes
        // prevent an interrupt within EditAnnotationLayer
        if (
          somethingChanged
          && !update.newSelectedKey
          && !update.newType
          && preventInterrupt
        ) {
          preventInterrupt();
        } else {
          // Otherwise, one of these state changes will trigger an interrupt.
          if (update.newSelectedKey) {
            selectedKey.value = update.newSelectedKey;
          }
          if (update.newType) {
            annotationModes.editing = update.newType;
            recipes.forEach((r) => r.deactivate());
          }
        }
        // Update the state of the track in the trackstore.
        if (somethingChanged) {
          track.setFeature({
            frame: frameNum,
            keyframe: true,
            bounds: updateBounds(real?.bounds, update.union, update.unionWithoutBounds),
            interpolate,
          }, flatMapDeep(update.geoJsonFeatureRecord,
            (geomlist, key_) => geomlist.map((geom) => ({
              type: geom.type,
              geometry: geom.geometry,
              properties: { key: key_ },
            }))));

          // Only perform "initialization" after the first shape
          if (eventType === 'editing') {
            // If it is a new track and we have newTrack Settings
            if (newTrackMode && newDetectionMode) {
              newTrackSettingsAfterLogic(track);
            }
            newDetectionMode = false;
          }
        }
      } else {
        throw new Error(`${selectedTrackId.value} missing from trackMap`);
      }
    } else {
      throw new Error('Cannot call handleUpdateGeojson without a selected Track ID');
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
            // bounds: findBounds(clone),
          }, [clone]);
        }
      }
    }
    handleSelectFeatureHandle(-1);
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

  function handleSetAnnotationState({
    visible, editing, key, recipeName,
  }: SetAnnotationStateArgs) {
    if (visible) {
      annotationModes.visible = visible;
    }
    if (editing) {
      annotationModes.editing = editing;
      _selectKey(key);
      handleSelectTrack(selectedTrackId.value, true);
    }
    recipes.forEach((r) => {
      if (recipeName !== r.name) {
        r.deactivate();
      }
    });
  }

  /* Subscribe to recipe activation events */
  recipes.forEach((r) => r.bus.$on('activate', handleSetAnnotationState));
  /* Unsubscribe before unmount */
  onBeforeUnmount(() => {
    recipes.forEach((r) => r.bus.$off('activate', handleSetAnnotationState));
  });

  return {
    editingMode,
    visibleModes,
    selectedFeatureHandle,
    selectedKey,
    handler: {
      selectTrack: handleSelectTrack,
      trackEdit: handleTrackEdit,
      trackTypeChange: handleTrackTypeChange,
      addTrack: handleAddTrack,
      updateRectBounds: handleUpdateRectBounds,
      updateGeoJSON: handleUpdateGeoJSON,
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
