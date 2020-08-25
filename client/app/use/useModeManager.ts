import {
  computed, Ref, reactive, ref,
} from '@vue/composition-api';
import { cloneDeep, uniq } from 'lodash';
import Track, { TrackId } from 'vue-media-annotator/track';
import {
  RectBounds, findBounds, removePoint, updateBounds,
} from 'vue-media-annotator/utils';
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
    visible: ['rectangle', 'Polygon', 'LineString'] as EditAnnotationTypes[],
    editing: 'rectangle' as EditAnnotationTypes,
  });
  // selectedFeatureHandle could arguably belong in useTrackSelectionControls,
  // but the meaning of this value varies based on the editing mode.  When in
  // polygon edit mode, this corresponds to a polygon point.  Ditto in line mode.
  const selectedFeatureHandle = ref(-1);
  //The Key of the selected type, for now mostly '' but is used for HeadTails Processing
  const selectedKey = ref('');
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

  function handleSelectKey(key: string | '') {
    selectedKey.value = key;
  }

  function handleSelectFeatureHandle(i: number, key = '') {
    selectedFeatureHandle.value = i;
    if (key !== '') {
      handleSelectKey(key);
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


  function handleFeaturePointing(key: 'head' | 'tail') {
    if (selectedTrackId.value !== null) {
      handleSelectKey(key);
      annotationModes.editing = 'Point';
      selectTrack(selectedTrackId.value, true);
    }
  }


  /** removing the entire HeadTails or one of the points */
  function removeHeadTails(frameNum: number, track: Track, index: number) {
    handleSelectTrack(selectedTrackId.value, false);
    track.removeFeatureGeometry(frameNum, {
      key: 'HeadTails',
      type: 'LineString',
    });
    if (index === -1 || index === 0) {
      track.removeFeatureGeometry(frameNum, {
        key: 'head',
        type: 'Point',
      });
    }
    if (index === -1 || index === 1) {
      track.removeFeatureGeometry(frameNum, {
        key: 'tail',
        type: 'Point',
      });
    }
  }
  /**
   * When creating a HeadTails Line this will update the individual points
   * or creating a line if we have both points available
   */
  function updateHeadTails(
    frameNum: number,
    track: Track,
    interpolate: boolean,
    key: string,
    data: GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>,
  ) {
    //Update the Head and Tails points as well
    if (data.geometry.type === 'LineString' && key === 'HeadTails') {
      const { coordinates } = data.geometry;

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
    } else if (data.geometry.type === 'Point') {
      //So now we have to add the Line if both points exist
      const coordinates: GeoJSON.Position[] = [];
      coordinates.push(data.geometry.coordinates);
      if (key === 'head') {
        const tail = track.getFeatureGeometry(frame.value, {
          type: 'Point',
          key: 'tail',
        });
        if (tail.length) {
          coordinates.push(tail[0].geometry.coordinates as GeoJSON.Position);
        }
      } else if (key === 'tail') {
        const head = track.getFeatureGeometry(frame.value, {
          type: 'Point',
          key: 'head',
        });
        if (head.length) {
          coordinates.unshift(head[0].geometry.coordinates as GeoJSON.Position);
        }
      }
      //Now we add the headTails item if the two points exist
      if (coordinates.length === 2) {
        const { features } = track.canInterpolate(frameNum);
        const [real] = features;
        //Update bounds based on type and condition of the updated bounds
        let oldBounds;
        if (real) {
          oldBounds = real.bounds;
        }

        const lineData: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates,
          },
          properties: {
            key: 'HeadTails',
          },
        };
        const newbounds = findBounds(lineData);
        const updatedBounds = updateBounds(oldBounds, newbounds, lineData);
        track.setFeature(
          {
            frame: frameNum,
            bounds: updatedBounds,
            keyframe: true,
            interpolate,
          },
          [lineData],
        );
      }
    }
  }


  function handleRemoveFeaturePoint() {
    if (selectedTrackId.value !== null) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        removeHeadTails(frame.value, track, -1);
      }
    }
  }

  const headTailReservedKeys = ['head', 'tail', 'HeadTails'];

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
        if (headTailReservedKeys.includes(key)) {
          updateHeadTails(frameNum, track, interpolateSetting, key, data);
        }

        //Update bounds based on type and condition of the updated bounds
        let oldBounds;
        if (real) {
          oldBounds = real.bounds;
        }
        const newbounds = findBounds(data);
        const updatedBounds = updateBounds(oldBounds, newbounds, data);

        const feature = {
          frame: frameNum,
          keyframe: true,
          bounds: updatedBounds,
          interpolate: (newDetectionMode && !newTrackMode)
            ? false : interpolateTrack,
        };
        // TODO: update to only work with polygon changes, not line changes
        track.setFeature(
          feature,
          [{
            type: data.type,
            geometry: data.geometry,
            properties: {
              key,
            },
          }],
        );

        //If we are creating a point, we swap back to rectangle once done
        //we also check if we need to make the line
        if (data.geometry.type === 'Point' && annotationModes.editing === 'Point') {
          handleSelectKey('');
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
        if (selectedKey.value === 'HeadTails') {
          removeHeadTails(frame.value, track, selectedFeatureHandle.value);
          handleSelectFeatureHandle(-1);
        } else if (removePoint(clone, selectedFeatureHandle.value)) {
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
    selectedKey,
    handler: {
      handleFeaturePointing,
      handleRemoveFeaturePoint,
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
      selectKey: handleSelectKey,
      removeAnnotation: handleRemoveAnnotation,
      selectFeatureHandle: handleSelectFeatureHandle,
      setAnnotationState: handleSetAnnotationState,
    },
  };
}
