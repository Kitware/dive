import {
  computed, Ref, reactive, ref,
} from '@vue/composition-api';
import { cloneDeep, uniq } from 'lodash';
import Track, { TrackId } from 'vue-media-annotator/track';
import { RectBounds, findBounds, removePoint } from 'vue-media-annotator/utils';
import { EditAnnotationTypes } from 'vue-media-annotator/layers/EditAnnotationLayer';

import { NewTrackSettings } from './useSettings';

export interface Seeker {
  seek(frame: number): void;
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
}: {
    selectedTrackId: Ref<TrackId | null>;
    editingTrack: Ref<boolean>;
    frame: Ref<number>;
    trackMap: Map<TrackId, Track>;
    playbackComponent: Ref<Seeker>;
    newTrackSettings: NewTrackSettings;
    selectTrack: (trackId: TrackId | null, edit: boolean) => void;
    getTrack: (trackId: TrackId) => Track;
    selectNextTrack: (delta?: number) => TrackId | null;
    addTrack: (frame: number, defaultType: string) => Track;
    removeTrack: (trackId: TrackId) => void;
}) {
  let newTrackMode = false;
  let newDetectionMode = false;

  const annotationModes = reactive({
    visible: ['rectangle', 'polygon', 'line'] as EditAnnotationTypes[],
    editing: 'rectangle' as EditAnnotationTypes,
  });
  // selectedFeatureHandle could arguably belong in useTrackSelectionControls,
  // but the meaning of this value varies based on the editing mode.  When in
  // polygon edit mode, this corresponds to a polygon point.  Ditto in line mode.
  const selectedFeatureHandle = ref(-1);
  // which type is currently being edited, if any
  const editingMode = computed(() => editingTrack.value && annotationModes.editing);
  // which types are currently visible, always including the editingType
  const visibleModes = computed(() => (
    uniq(annotationModes.visible.concat(editingMode.value || []))
  ));

  function seekNearest(track: Track) {
    // Seek to the nearest point in the track.
    if (frame.value < track.begin) {
      playbackComponent.value.seek(track.begin);
    } else if (frame.value > track.end) {
      playbackComponent.value.seek(track.end);
    }
  }

  function handleSelectFeatureHandle(i: number) {
    selectedFeatureHandle.value = i;
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
        const interpolateTrack = newTrackMode
          ? newTrackSettings.modeSettings.Track.interpolate
          : interpolate;
        track.setFeature({
          frame: frameNum,
          bounds,
          keyframe: true,
          interpolate: (newDetectionMode && !newTrackMode)
            ? false : interpolateTrack,
        });
        //If it is a new track and we have newTrack Settings
        if (newTrackMode && newDetectionMode) {
          newTrackSettingsAfterLogic(track);
        }
        newDetectionMode = false;
      }
    }
  }

  function updateHeadTails(
    frameNum: number,
    track: Track,
    interpolate: boolean,
    coordinates: GeoJSON.Position[],
  ) {
    //Update the Head and Tails points as well
    const geoJSONPointHead: GeoJSON.Point = {
      type: 'Point',
      coordinates: coordinates[0],
    };
    track.setFeature({
      frame: frameNum,
      keyframe: true,
      interpolate,
    },
    [{
      type: 'Feature',
      geometry: geoJSONPointHead,
      properties: {
        key: 'head',
      },
    }]);
    // eslint-disable-next-line prefer-destructuring
    const geoJSONPointTail: GeoJSON.Point = {
      type: 'Point',
      coordinates: coordinates[1],
    };
    track.setFeature({
      frame: frameNum,
      keyframe: true,
      interpolate,
    },
    [{
      type: 'Feature',
      geometry: geoJSONPointTail,
      properties: {
        key: 'tail',
      },
    }]);
  }

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
        const interpolateTrack = newTrackMode
          ? newTrackSettings.modeSettings.Track.interpolate
          : interpolate;
        const interpolateSetting = (newDetectionMode && !newTrackMode)
          ? false : interpolateTrack;
        if (data.geometry.type === 'LineString') {
          updateHeadTails(frameNum, track, interpolateSetting, data.geometry.coordinates);
        }
        // TODO: update to only work with polygon changes, not line changes
        track.setFeature(
          {
            frame: frameNum,
            keyframe: true,
            interpolate: (newDetectionMode && !newTrackMode)
              ? false : interpolateTrack,
          },
          [{
            type: data.type,
            geometry: data.geometry,
            properties: {
              key,
            },
          }],
        );
        //Update bounds based on type and condition of the updated bounds
        if (false && real) {
          const oldBounds = real?.bounds || 0;
          const newbounds = findBounds(data);
          if (newbounds > oldBounds) {
            //update if polygon or line
          } else if (newbounds < oldBounds) {
            //updat eonly if it is a polygon
          }
        }
        //If it is a new track and we have newTrack Settings
        if (newTrackMode && newDetectionMode) {
          newTrackSettingsAfterLogic(track);
        }
        newDetectionMode = false;
      }
    }
  }

  const modeMap: {point: 'Point'; line: 'LineString'; polygon: 'Polygon'} = {
    point: 'Point',
    line: 'LineString',
    polygon: 'Polygon',
  };
  /**
   * Removes the selectedIndex point for the selected Polygon/line
   */
  function handleRemovePoint(key = '', type: '' | 'Point' | 'Polygon' | 'LineString' = '') {
    if (selectedTrackId.value !== null && selectedFeatureHandle.value !== -1) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        // Determines if we are creating a new Detection
        const { features } = track.canInterpolate(frame.value);
        const [real] = features;
        if (!real) return;
        const geoJSONType = type !== '' ? type : modeMap[annotationModes.editing as 'polygon' | 'line'];
        const geoJsonFeatures = track.getFeatureGeometry(frame.value, {
          type: geoJSONType,
          key,
        });
        if (geoJsonFeatures.length === 0) return;
        //could operate directly on the polygon memory, but small enough to copy and edit
        const clone = cloneDeep(geoJsonFeatures[0]);
        if (removePoint(clone, selectedFeatureHandle.value)) {
          handleSelectFeatureHandle(-1);
          track.setFeature({
            frame: frame.value,
            bounds: findBounds(clone),
          }, [clone]);
        } else {
          console.warn('Polygons must have at least 3 points');
        }
      }
    }
  }

  function handleRemoveAnnotation(frameNum: number, key = '', type: '' | 'Point' | 'Polygon' | 'LineString' = '') {
    if (selectedTrackId.value !== null && selectedFeatureHandle.value !== -1) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        // Determines if we are creating a new Detection
        const { features } = track.canInterpolate(frame.value);
        const [real] = features;
        if (!real) return false;
        // TODO: This can be changed when we have selection of annotations by key/type
        const geoJSONType = type !== '' ? type : modeMap[annotationModes.editing as 'polygon' | 'line'];
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

  function handleSetAnnotationState({ visible, editing }: {
    visible?: EditAnnotationTypes[];
    editing?: EditAnnotationTypes;
  }) {
    if (visible) annotationModes.visible = visible;
    if (editing) annotationModes.editing = editing;
  }

  return {
    editingMode,
    visibleModes,
    selectedFeatureHandle,
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
