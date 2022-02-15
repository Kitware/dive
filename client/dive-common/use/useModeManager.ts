import {
  computed, Ref, reactive, ref, onBeforeUnmount, toRef,
} from '@vue/composition-api';
import { uniq, flatMapDeep } from 'lodash';
import Track, { TrackId } from 'vue-media-annotator/track';
import { getTrack } from 'vue-media-annotator/use/useTrackStore';
import { RectBounds, updateBounds } from 'vue-media-annotator/utils';
import { EditAnnotationTypes, VisibleAnnotationTypes } from 'vue-media-annotator/layers';
import { AggregateMediaController } from 'vue-media-annotator/components/annotators/mediaControllerType';

import Recipe from 'vue-media-annotator/recipe';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { clientSettings } from 'dive-common/store/settings';

type SupportedFeature = GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>;

interface SetAnnotationStateArgs {
  visible?: VisibleAnnotationTypes[];
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
  selectedCamera,
  editingTrack,
  trackMap,
  camTrackMap,
  aggregateController,
  recipes,
  selectTrack,
  selectNextTrack,
  addTrack,
  removeTrack,
}: {
  selectedTrackId: Ref<TrackId | null>;
  selectedCamera: Ref<string>;
  editingTrack: Ref<boolean>;
  trackMap: Map<TrackId, Track>;
  camTrackMap: Record<string, Map<TrackId, Track>>;
    aggregateController: Ref<AggregateMediaController>;
  recipes: Recipe[];
  selectTrack: (trackId: TrackId | null, edit: boolean) => void;
  selectNextTrack: (delta?: number) => TrackId | null;
  addTrack: (frame: number, defaultType: string, afterId?: TrackId, cameraName?: string) => Track;
  removeTrack: (trackId: TrackId) => void;
}) {
  let creating = false;

  const annotationModes = reactive({
    visible: ['rectangle', 'Polygon', 'LineString', 'text'] as VisibleAnnotationTypes[],
    editing: 'rectangle' as EditAnnotationTypes,
  });
  const trackSettings = toRef(clientSettings, 'trackSettings');

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
  // Track merge state
  const mergeList = ref([] as TrackId[]);
  const mergeInProgress = computed(() => mergeList.value.length > 0);

  const { prompt } = usePrompt();
  /**
   * Figure out if a new feature should enable interpolation
   * based on current state and the result of canInterolate.
   */
  function _shouldInterpolate(canInterpolate: boolean) {
    // if this is a track, then whether to interpolate
    // is determined by newTrackSettings (if new track)
    // or canInterpolate (if existing track)
    const interpolateTrack = creating
      ? trackSettings.value.newTrackSettings.modeSettings.Track.interpolate
      : canInterpolate;
    // if detection, interpolate is always false
    return trackSettings.value.newTrackSettings.mode === 'Detection'
      ? false
      : interpolateTrack;
  }

  function seekNearest(track: Track) {
    // Seek to the nearest point in the track.
    const { frame } = aggregateController.value;
    if (frame.value < track.begin) {
      aggregateController.value.seek(track.begin);
    } else if (frame.value > track.end) {
      aggregateController.value.seek(track.end);
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
    if (i !== selectedFeatureHandle.value) {
      selectedFeatureHandle.value = i;
    } else {
      selectedFeatureHandle.value = -1;
    }
    _selectKey(key);
  }

  function handleSelectTrack(trackId: TrackId | null, edit = false) {
    /**
     * If creating mode and editing and selectedTrackId is the same,
     * don't kick out of creating mode.  This happens when moving between
     * rect/poly/line during continuous creation.
     */
    if (!(creating && edit && trackId === selectedTrackId.value)) {
      creating = false;
    }
    /**
     * If merge is in progress, add selected tracks to the merge list
     */
    if (trackId !== null && mergeInProgress.value) {
      mergeList.value = Array.from((new Set(mergeList.value).add(trackId)));
    }
    /* Do not allow editing when merge is in progres */
    selectTrack(trackId, edit && !mergeInProgress.value);
  }

  //Handles deselection or hitting escape including while editing
  function handleEscapeMode() {
    if (selectedTrackId.value !== null) {
      const track = trackMap.get(selectedTrackId.value);
      if (track && track.begin === track.end) {
        const features = track.getFeature(track.begin);
        // If no features exist we remove the empty track
        if (!features.filter((item) => item !== null).length) {
          removeTrack(selectedTrackId.value);
        }
      }
    }
    mergeList.value = [];
    handleSelectTrack(null, false);
  }

  function handleAddTrackOrDetection(): TrackId {
    // Handles adding a new track with the NewTrack Settings
    const { frame } = aggregateController.value;
    const newTrackId = addTrack(
      frame.value, trackSettings.value.newTrackSettings.type,
      selectedTrackId.value || undefined, selectedCamera.value,
    ).trackId;
    selectTrack(newTrackId, true);
    creating = true;
    return newTrackId;
  }

  function handleTrackTypeChange(trackId: TrackId | null, value: string) {
    if (trackId !== null) {
      getTrack(trackMap, trackId).setType(value);
    }
  }

  function newTrackSettingsAfterLogic(addedTrack: Track) {
    // Default settings which are updated by the TrackSettings component
    let newCreatingValue = false; // by default, disable creating at the end of this function
    if (creating) {
      if (addedTrack && trackSettings.value.newTrackSettings !== null) {
        if (trackSettings.value.newTrackSettings.mode === 'Track'
        && trackSettings.value.newTrackSettings.modeSettings.Track.autoAdvanceFrame
        ) {
          aggregateController.value.nextFrame();
          newCreatingValue = true;
        } else if (trackSettings.value.newTrackSettings.mode === 'Detection') {
          if (
            trackSettings.value.newTrackSettings.modeSettings.Detection.continuous) {
            handleAddTrackOrDetection();
            newCreatingValue = true; // don't disable creating mode
          }
        }
      }
    }
    creating = newCreatingValue;
  }

  function handleUpdateRectBounds(frameNum: number, flickNum: number, bounds: RectBounds) {
    if (selectedTrackId.value !== null) {
      let track = trackMap.get(selectedTrackId.value);
      if (selectedCamera.value !== 'default') {
        track = camTrackMap[selectedCamera.value].get(selectedTrackId.value);
      }
      if (track) {
        // Determines if we are creating a new Detection
        const { interpolate } = track.canInterpolate(frameNum);

        track.setFeature({
          frame: frameNum,
          flick: flickNum,
          bounds,
          keyframe: true,
          interpolate: _shouldInterpolate(interpolate),
        });
        newTrackSettingsAfterLogic(track);
      }
    }
  }

  function handleUpdateGeoJSON(
    eventType: 'in-progress' | 'editing',
    frameNum: number,
    flickNum: number,
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
      // If the recipe has completed
      done: [] as (boolean|undefined)[],
    };

    if (selectedTrackId.value !== null) {
      let track = trackMap.get(selectedTrackId.value);
      if (selectedCamera.value !== 'default') {
        track = camTrackMap[selectedCamera.value].get(selectedTrackId.value);
      }
      if (track) {
        // newDetectionMode is true if there's no keyframe on frameNum
        const { features, interpolate } = track.canInterpolate(frameNum);
        const [real] = features;

        // Give each recipe the opportunity to make changes
        recipes.forEach((recipe) => {
          if (!track) {
            return;
          }
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
          update.done.push(changes.done);
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
            flick: flickNum,
            keyframe: true,
            bounds: updateBounds(real?.bounds, update.union, update.unionWithoutBounds),
            interpolate,
          }, flatMapDeep(update.geoJsonFeatureRecord,
            (geomlist, key_) => geomlist.map((geom) => ({
              type: geom.type,
              geometry: geom.geometry,
              properties: { key: key_ },
            }))));

          // Only perform "initialization" after the first shape.
          // Treat this as a completed annotation if eventType is editing
          // Or none of the recieps reported that they were unfinished.
          if (eventType === 'editing' || update.done.every((v) => v !== false)) {
            newTrackSettingsAfterLogic(track);
          }
        }
      } else {
        throw new Error(`${selectedTrackId.value} missing from trackMap`);
      }
    } else {
      throw new Error('Cannot call handleUpdateGeojson without a selected Track ID');
    }
  }

  /* If any recipes are active, allow them to remove a point */
  function handleRemovePoint() {
    if (selectedTrackId.value !== null && selectedFeatureHandle.value !== -1) {
      let track = trackMap.get(selectedTrackId.value);
      if (selectedCamera.value !== 'default') {
        track = camTrackMap[selectedCamera.value].get(selectedTrackId.value);
      }
      if (track !== undefined) {
        recipes.forEach((r) => {
          if (r.active.value && track) {
            const { frame } = aggregateController.value;
            r.deletePoint(
              frame.value,
              track,
              selectedFeatureHandle.value,
              selectedKey.value,
              annotationModes.editing,
            );
          }
        });
      }
    }
    handleSelectFeatureHandle(-1);
  }

  /* If any recipes are active, remove the geometry they added */
  function handleRemoveAnnotation() {
    if (selectedTrackId.value !== null) {
      let track = trackMap.get(selectedTrackId.value);
      if (selectedCamera.value !== 'default') {
        track = camTrackMap[selectedCamera.value].get(selectedTrackId.value);
      }
      if (track !== undefined) {
        const { frame } = aggregateController.value;
        recipes.forEach((r) => {
          if (r.active.value && track) {
            r.delete(frame.value, track, selectedKey.value, annotationModes.editing);
          }
        });
      }
    }
  }

  /**
   * Unstage a track from the merge list
   */
  function handleUnstageFromMerge(trackIds: TrackId[]) {
    mergeList.value = mergeList.value.filter((trackId) => !trackIds.includes(trackId));
  }

  async function handleRemoveTrack(trackIds: TrackId[], forcePromptDisable = false) {
    /* Figure out next track ID */
    const maybeNextTrackId = selectNextTrack(1);
    const previousOrNext = maybeNextTrackId !== null
      ? maybeNextTrackId
      : selectNextTrack(-1);
    /* Delete track */
    if (!forcePromptDisable && trackSettings.value.deletionSettings.promptUser) {
      const trackStrings = trackIds.map((track) => track.toString());
      const text = (['Would you like to delete the following tracks:']).concat(trackStrings);
      text.push('');
      text.push('This setting can be changed under the Track Settings');
      const result = await prompt({
        title: 'Delete Confirmation',
        text,
        positiveButton: 'OK',
        negativeButton: 'Cancel',
        confirm: true,
      });
      if (!result) {
        return;
      }
    }
    trackIds.forEach((trackId) => {
      removeTrack(trackId);
    });
    handleUnstageFromMerge(trackIds);
    selectTrack(previousOrNext, false);
  }

  /** Toggle editing mode for track */
  function handleTrackEdit(trackId: TrackId) {
    let track = getTrack(trackMap, trackId);
    if (selectedCamera.value !== 'default') {
      track = getTrack(camTrackMap[selectedCamera.value], trackId);
    }
    seekNearest(track);
    const editing = trackId === selectedTrackId.value ? (!editingTrack.value) : true;
    handleSelectTrack(trackId, editing);
  }

  function handleTrackClick(trackId: TrackId) {
    const track = getTrack(trackMap, trackId);
    seekNearest(track);
    handleSelectTrack(trackId, editingTrack.value);
  }

  function handleSelectNext(delta: number) {
    const newTrack = selectNextTrack(delta);
    if (newTrack !== null) {
      handleSelectTrack(newTrack, false);
      seekNearest(getTrack(trackMap, newTrack));
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
      recipes.forEach((r) => {
        if (recipeName !== r.name) {
          r.deactivate();
        }
      });
    }
  }

  /**
   * Merge: Enabled whenever there are candidates in the merge list
   */
  function handleToggleMerge(): TrackId[] {
    if (!mergeInProgress.value && selectedTrackId.value !== null) {
      /* If no merge in progress and there is a selected track id */
      mergeList.value = [selectedTrackId.value];
      /* no editing in merge mode */
      selectTrack(selectedTrackId.value, false);
    } else {
      mergeList.value = [];
    }
    return mergeList.value;
  }

  /**
   * Merge: Commit the merge list
   */
  function handleCommitMerge() {
    if (mergeList.value.length >= 2) {
      const track = getTrack(trackMap, mergeList.value[0]);
      const otherTrackIds = mergeList.value.slice(1);
      track.merge(otherTrackIds.map((trackId) => getTrack(trackMap, trackId)));
      handleRemoveTrack(otherTrackIds, true);
      handleToggleMerge();
      handleSelectTrack(track.trackId, false);
    }
  }

  /* Subscribe to recipe activation events */
  recipes.forEach((r) => r.bus.$on('activate', handleSetAnnotationState));
  /* Unsubscribe before unmount */
  onBeforeUnmount(() => {
    recipes.forEach((r) => r.bus.$off('activate', handleSetAnnotationState));
  });

  return {
    editingMode,
    mergeList,
    mergeInProgress,
    visibleModes,
    selectedFeatureHandle,
    selectedKey,
    handler: {
      commitMerge: handleCommitMerge,
      toggleMerge: handleToggleMerge,
      trackAdd: handleAddTrackOrDetection,
      trackAbort: handleEscapeMode,
      trackEdit: handleTrackEdit,
      trackSeek: handleTrackClick,
      trackSelect: handleSelectTrack,
      trackSelectNext: handleSelectNext,
      trackTypeChange: handleTrackTypeChange,
      updateRectBounds: handleUpdateRectBounds,
      updateGeoJSON: handleUpdateGeoJSON,
      removeTrack: handleRemoveTrack,
      removePoint: handleRemovePoint,
      removeAnnotation: handleRemoveAnnotation,
      selectFeatureHandle: handleSelectFeatureHandle,
      setAnnotationState: handleSetAnnotationState,
      unstageFromMerge: handleUnstageFromMerge,
    },
  };
}
