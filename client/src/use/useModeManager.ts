import {
  Ref, reactive, toRefs,
} from '@vue/composition-api';
import { cloneDeep } from 'lodash';

import Track, { TrackId } from '@/lib/track';
import { RectBounds, findBounds, removePoint } from '@/utils';
import { EditAnnotationTypes } from '@/components/layers/EditAnnotationLayer';
import { NewTrackSettings } from './useSettings';

export interface EditorSettings {
  state: Ref<{
    visible: EditAnnotationTypes[];
    editing: EditAnnotationTypes;
  }>;
  selectedFeatureHandle: Ref<number>;
}


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
    state: {
      visible: ['rectangle', 'polygon', 'line'],
      editing: 'rectangle',
    },
    // selectedFeatureHandle could arguably belong in useTrackSelectionControls,
    // but the meaning of this value varies based on the editing mode.  When in
    // polygon edit mode, this corresponds to a polygon point.  Ditto in line mode.
    selectedFeatureHandle: -1,
  });

  function seekNearest(track: Track) {
    // Seek to the nearest point in the track.
    if (frame.value < track.begin) {
      playbackComponent.value.seek(track.begin);
    } else if (frame.value > track.end) {
      playbackComponent.value.seek(track.end);
    }
  }

  function handleSelectFeatureHandle(i: number) {
    annotationModes.selectedFeatureHandle = i;
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

  //Want to use this as a base function for updating geoJSON items
  function handleUpdateGeoJSON(
    frameNum: number,
    data: GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>,
    key: string,
  ) {
    //Now we would go through the different types and create or handle updating
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
        // TODO: update to only work with polygon changes, not line changes
        track.setFeature(
          {
            frame: frameNum,
            bounds: findBounds(data),
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
    if (selectedTrackId.value !== null && annotationModes.selectedFeatureHandle !== -1) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        // Determines if we are creating a new Detection
        const { features } = track.canInterpolate(frame.value);
        const [real] = features;
        if (!real) return;
        // TODO: This can be changed when we have selection of annotations by key/type
        const geoJSONType = type !== '' ? type : modeMap[annotationModes.state.editing as 'polygon' | 'line'];
        const geoJsonFeatures = track.getFeatureGeometry(frame.value, {
          type: geoJSONType,
          key,
        }) as GeoJSON.Feature<GeoJSON.Polygon>[];
        if (geoJsonFeatures.length === 0) return;
        //could operate directly on the polygon memory, but small enough to copy and edit
        const clone = cloneDeep(geoJsonFeatures[0]);
        if (removePoint(clone, annotationModes.selectedFeatureHandle)) {
          handleSelectFeatureHandle(-1);
          track.setFeature({
            frame: frame.value,
            bounds: findBounds(clone),
          }, [clone]);
        }
      }
    }
  }

  function handleRemoveAnnotation(frameNum: number, key = '', type: '' | 'Point' | 'Polygon' | 'LineString' = '') {
    if (selectedTrackId.value !== null && annotationModes.selectedFeatureHandle !== -1) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        // Determines if we are creating a new Detection
        const { features } = track.canInterpolate(frame.value);
        const [real] = features;
        if (!real) return false;
        // TODO: This can be changed when we have selection of annotations by key/type
        const geoJSONType = type !== '' ? type : modeMap[annotationModes.state.editing as 'polygon' | 'line'];
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
    if (visible) annotationModes.state.visible = visible;
    if (editing) annotationModes.state.editing = editing;
  }

  return {
    annotationModes: toRefs(annotationModes) as EditorSettings,
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
