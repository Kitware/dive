import { Ref, ref, watch } from '@vue/composition-api';
import Track, { TrackId } from '@/lib/track';
import { RectBounds, findBounds } from '@/utils';
import { NewTrackSettings } from './useSettings';

export interface Seeker {
    seek(frame: number): void;
    nextFrame(): void;
  }


export type AnnotationState = 'enabled' | 'disabled' | 'selected';
export type AnnotationTypes = 'rectangle' | 'polygon' | 'line' | 'point';
export interface AnnotationDisplay {
  id: AnnotationTypes;
  title: string;
  icon: string;
  state?: AnnotationState;
}

export interface EditorSettings {
  mode: 'visible' | 'editing';
  helpMode: 'visible' | 'editing' | 'creation';
  display: AnnotationDisplay[];
  states: {
    visible: Record<AnnotationTypes, AnnotationState>;
    editing: Record<AnnotationTypes, AnnotationState>;
  };
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

  // Seek to the nearest point in the track.
  function seekNearest(track: Track) {
    if (frame.value < track.begin) {
      playbackComponent.value.seek(track.begin);
    } else if (frame.value > track.end) {
      playbackComponent.value.seek(track.end);
    }
  }

  function handleSelectTrack(trackId: TrackId | null, edit = false) {
    selectTrack(trackId, edit);
    if (newTrackMode && !edit) {
      newTrackMode = false;
    }
  }

  //Handles adding a new track with the NewTrack Settings
  function handleAddTrack() {
    selectTrack(addTrack(frame.value, newTrackSettings.type).trackId, true);
    newTrackMode = true;
  }

  function handleTrackTypeChange({ trackId, value }: { trackId: TrackId; value: string }) {
    getTrack(trackId).setType(value);
  }
  // Default settings which are updated by the CreationMode component
  // Not making them reactive, and eventually will probably be in localStorage


  function newTrackSettingsAfterLogic(addedTrack: Track) {
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

  function handleUpdatePolygon(frameNum: number, data: GeoJSON.Polygon) {
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
          polygon: data,
          bounds: findBounds(data),
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

  const annotationModes: Ref<EditorSettings> = ref({
    mode: 'visible',
    helpMode: 'visible',
    display: [
      { id: 'rectangle', title: 'Bounds', icon: 'mdi-vector-square' },
      { id: 'polygon', title: 'Polygon', icon: 'mdi-vector-polygon' },
      { id: 'line', title: 'Lines', icon: 'mdi-vector-line' },
      { id: 'point', title: 'Points', icon: 'mdi-vector-point' },

    ],
    states: {
      visible: {
        rectangle: 'selected',
        polygon: 'selected',
        point: 'selected',
        line: 'selected',
      },
      editing: {
        rectangle: 'selected',
        polygon: 'enabled',
        point: 'enabled',
        line: 'enabled',
      },
    },
  });

  const annotationUpdate: Ref<boolean> = ref(false);
  function updateAnnotationMode({ mode, type, annotState }:
    {mode: 'visible' | 'editing'; type: AnnotationTypes; annotState: AnnotationState }) {
    //Depending on the current mode we update the state
    annotationModes.value.mode = mode;
    if (annotationModes.value.mode === 'visible') {
      annotationModes.value.states[mode][type] = annotState;
    } else if (annotationModes.value.mode === 'editing') {
      //Only one can be active at a time:
      (Object.keys(annotationModes.value.states.editing) as AnnotationTypes[]).forEach((key) => {
        annotationModes.value.states.editing[key] = 'enabled';
      });
      annotationModes.value.states[mode][type] = annotState;
    }
    annotationUpdate.value = !annotationUpdate.value;
  }
  function updateAnnotationHelpMode(helpMode: 'visible' | 'editing' | 'creation') {
    annotationModes.value.helpMode = helpMode;
  }
  watch(editingTrack, (newval: boolean) => {
    if (newval) {
      annotationModes.value.mode = 'editing';
    } else {
      annotationModes.value.mode = 'visible';
      annotationModes.value.helpMode = 'visible';
    }
  });


  return {
    handler: {
      selectTrack: handleSelectTrack,
      trackEdit: handleTrackEdit,
      trackTypeChange: handleTrackTypeChange,
      addTrack: handleAddTrack,
      updateRectBounds: handleUpdateRectBounds,
      updatePolygon: handleUpdatePolygon,
      selectNext: handleSelectNext,
      trackClick: handleTrackClick,
      removeTrack: handleRemoveTrack,
      annotationModes,
      annotationUpdate,
      updateAnnotationMode,
      updateAnnotationHelpMode,
    },
  };
}
