import { Ref } from '@vue/composition-api';
import Track, { TrackId } from '@/lib/track';
import { RectBounds } from '@/utils';
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
        const features = track.getFeature(frameNum);
        const [real, upper, lower] = features;
        if (!real || real.bounds === undefined) {
          newDetectionMode = true;
        }
        // A new keyframe enables interpolation
        // iff its lower bound allows it OR it has no
        // lower bound and its upper bound allows it
        // OR the existing feature at the current frame
        // allows it. This final case happens when an interpolated
        // frame is edited to become a keyframe.
        const interpolateTrack = newTrackMode
          ? newTrackSettings.modeSettings.Track.interpolate
          : !!(real?.interpolate || (lower?.interpolate) || (!lower && upper?.interpolate));
        track.setFeature({
          frame: frameNum,
          bounds,
          keyframe: true,
          interpolate: newDetectionMode ? false : interpolateTrack,
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
      if (newTrack !== null) {
        selectTrack(newTrack, false);
      }
    }
    removeTrack(trackId);
  }

  function handleTrackEdit(trackId: TrackId) {
    const track = getTrack(trackId);
    seekNearest(track);
    selectTrack(trackId, true);
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

  return {
    handler: {
      selectTrack: handleSelectTrack,
      trackEdit: handleTrackEdit,
      trackTypeChange: handleTrackTypeChange,
      addTrack: handleAddTrack,
      updateRectBounds: handleUpdateRectBounds,
      selectNext: handleSelectNext,
      trackClick: handleTrackClick,
      removeTrack: handleRemoveTrack,
    },
  };
}
