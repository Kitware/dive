import { Ref, computed } from '@vue/composition-api';
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
  function handleSelectTrack(trackId: TrackId | null, edit = false) {
    selectTrack(trackId, edit);
  }
  //Handles adding a new track with the NewTrack Settings
  function handleAddTrack() {
    selectTrack(addTrack(frame.value, newTrackSettings.type).trackId, true);
  }

  function handleTrackTypeChange({ trackId, value }: { trackId: TrackId; value: string }) {
    getTrack(trackId).setType(value);
  }

  function newTrackSettingsAfterLogic(newTrack: Track) {
    if (newTrack && newTrackSettings !== null) {
      if (newTrackSettings.mode === 'Track' && newTrackSettings.modeSettings.Track.autoAdvanceFrame) {
        playbackComponent.value.nextFrame();
      } else if (newTrackSettings.mode === 'Detection') {
        if (newTrackSettings.modeSettings.Detection.continuous) {
          handleAddTrack();
        } else { //Deselect the new track
          selectTrack(newTrack.trackId, false);
        }
      }
    }
  }

  function handleUpdateRectBounds(frameNum: number, bounds: RectBounds) {
    if (selectedTrackId.value !== null) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        const features = track.getFeature(frameNum);
        let newTrack = false;
        if (!features || features.bounds === undefined) {
        //We are creating a brand new track and should apply the newTrackSettings
          newTrack = true;
        }
        track.setFeature({
          frame: frameNum,
          bounds,
        });
        //If it is a new track and we have newTrack Settings
        if (newTrack) {
          newTrackSettingsAfterLogic(track);
        }
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
    playbackComponent.value.seek(track.begin);
    selectTrack(trackId, true);
  }

  function handleTrackClick(trackId: TrackId) {
    const track = getTrack(trackId);
    playbackComponent.value.seek(track.begin);
    selectTrack(trackId, editingTrack.value);
  }

  function handleSelectNext(delta: number) {
    const newTrack = selectNextTrack(delta);
    if (newTrack !== null) {
      selectTrack(newTrack, false);
      const track = getTrack(newTrack);
      playbackComponent.value.seek(track.begin);
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
