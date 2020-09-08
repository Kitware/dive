import {
  computed, Ref, reactive, ref,
} from '@vue/composition-api';
import { cloneDeep, uniq, flatMapDeep } from 'lodash';
import Track, { TrackId, Feature } from 'vue-media-annotator/track';
import {
  RectBounds, removePoint, updateBounds,
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
    if (typeof key === 'string') {
      selectedKey.value = key;
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
    frameNum: number,
    data: GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>,
    key?: string,
    preventInterrupt?: () => void,
  ) {
    const update = {
      // Transformed geometry data
      geoJsonFeatureRecord: {} as Record<string,
        GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>[]>,
      union: [] as GeoJSON.Polygon[],
      unionWithoutBounds: [] as GeoJSON.Polygon[],
      newMode: undefined as 'visible' | 'editing' | 'creation' | undefined,
      newType: undefined as EditAnnotationTypes | undefined,
      newSelectedKey: undefined as string | undefined,
    };

    if (key !== undefined) {
      update.geoJsonFeatureRecord[key] = [data];
    }

    if (selectedTrackId.value !== null) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        // Determines if we are creating a new Detection
        const { features, interpolate } = track.canInterpolate(frameNum);
        const [real] = features;
        if (!real || real.bounds === undefined) {
          newDetectionMode = true;
        }

        // Give recipes the opportunity to make changes
        for (let i = 0; i < recipes.length; i += 1) {
          const recipe = recipes[i];
          const changes = recipe.update(frameNum, track, [data], key);
          Object.assign(update.geoJsonFeatureRecord, changes.data);
          update.union.push(...changes.union);
          update.unionWithoutBounds.push(...changes.unionWithoutBounds);
          console.log('changes', changes, key);
          update.newMode = update.newMode || changes.newMode;
          update.newType = update.newType || changes.newType;
          update.newSelectedKey = update.newSelectedKey || changes.newSelectedKey;
        }

        console.log('update', update, preventInterrupt);
        if (
          !update.newMode
          && !update.newSelectedKey
          && !update.newType
          && preventInterrupt
        ) {
          /**
           * Normally, we want to prevent interrupting the editor
           * but sometimes an interrupt is necessary
           */
          preventInterrupt();
        }

        // Switch other modes if a recipe requested it
        if (update.newMode) selectTrack(selectedTrackId.value, update.newMode === 'editing');
        if (update.newSelectedKey) selectedKey.value = update.newSelectedKey;
        if (update.newType) annotationModes.editing = update.newType;

        if (Object.keys(update.geoJsonFeatureRecord).length) {
          // Persist the changes into the track object
          // flatten the { key: geom[], key2: geom[], ... } argument into a geom array.
          if (data.geometry.type === 'Polygon') {
            update.unionWithoutBounds.push(data.geometry);
          }
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

          //If it is a new track and we have newTrack Settings
          if (newTrackMode && newDetectionMode) {
            newTrackSettingsAfterLogic(track);
          }
          newDetectionMode = false;
        }
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
            // bounds: findBounds(clone),
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
      _selectKey(key);
      selectTrack(selectedTrackId.value, true);
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
