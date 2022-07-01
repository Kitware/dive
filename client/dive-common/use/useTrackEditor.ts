import {
  computed, onBeforeUnmount, reactive, ref, Ref, toRef,
} from '@vue/composition-api';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import CameraStore from 'vue-media-annotator/CameraStore';
import { AggregateMediaController } from 'vue-media-annotator/components/annotators/mediaControllerType';
import { EditAnnotationTypes, VisibleAnnotationTypes } from 'vue-media-annotator/layers';
import Recipe from 'vue-media-annotator/recipe';
import { clientSettings } from 'dive-common/store/settings';
import Track, { TrackId } from 'vue-media-annotator/track';
import { RectBounds, updateBounds } from 'vue-media-annotator/utils';
import { flatMapDeep, uniq } from 'lodash';

type SupportedFeature = GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>;
interface SetAnnotationStateArgs {
    visible?: VisibleAnnotationTypes[];
    editing?: EditAnnotationTypes;
    key?: string;
    recipeName?: string;
}

/**
 * Track Editor holds the track editing state and transitions between multiple state of editing
 * There are multiple track types and this handles editing and shuffling between them
 */
export default function useTrackEditor({
  selectedTrackId,
  editingTrack,
  cameraStore,
  aggregateController,
  selectedCamera,
  addTrackOrDetection,
  selectTrack,
  recipes,
}: {
    selectedTrackId: Ref<AnnotationId | null>;
    editingTrack: Ref<boolean>;
    cameraStore: CameraStore;
    aggregateController: Ref<AggregateMediaController>;
    selectedCamera: Ref<string>;
    addTrackOrDetection: (overrideTrackId?: AnnotationId) => TrackId;
    selectTrack: (trackId: TrackId | null, edit?: boolean) => void;
    recipes: Recipe[];
}) {
  let creating = false;
  const editingCanary = ref(false);
  // Meaning of this value varies based on the editing mode.  When in
  // polygon edit mode, this corresponds to a polygon point.  Ditto in line mode.
  const selectedFeatureHandle = ref(-1);
  //The Key of the selected type, for now mostly ''
  const selectedKey = ref('');

  const annotationModes = reactive({
    visible: ['rectangle', 'Polygon', 'LineString', 'text'] as VisibleAnnotationTypes[],
    editing: 'rectangle' as EditAnnotationTypes,
  });

  const trackSettings = toRef(clientSettings, 'trackSettings');
  const editingMode = computed(() => editingTrack.value && annotationModes.editing);

  const visibleModes = computed(() => (
    uniq(annotationModes.visible.concat(editingMode.value || []))
  ));

  function _depend(): boolean {
    return editingCanary.value;
  }

  function _nudgeEditingCanary() {
    editingCanary.value = !editingCanary.value;
  }

  // What is occuring in editing mode
  const editingDetails = computed(() => {
    _depend();
    if (editingMode.value && selectedTrackId.value !== null) {
      const { frame } = aggregateController.value;
      try {
        const track = cameraStore.getPossibleTrack(selectedTrackId.value, selectedCamera.value);
        if (track) {
          const [feature] = track.getFeature(frame.value);
          if (feature) {
            if (!feature?.bounds?.length) {
              return 'Creating';
            } if (annotationModes.editing === 'rectangle') {
              return 'Editing';
            }
            return (feature.geometry?.features.filter((item) => item.geometry.type === annotationModes.editing).length ? 'Editing' : 'Creating');
          }
          return 'Creating';
        }
      } catch {
        // No Track for this camera
        return 'disabled';
      }
    }
    return 'disabled';
  });

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
            addTrackOrDetection(cameraStore.getNewTrackId());
            newCreatingValue = true; // don't disable creating mode
          }
        }
      }
    }
    _nudgeEditingCanary();
    creating = newCreatingValue;
  }

  function handleUpdateRectBounds(frameNum: number, flickNum: number, bounds: RectBounds) {
    if (selectedTrackId.value !== null) {
      const track = cameraStore.getPossibleTrack(selectedTrackId.value, selectedCamera.value);
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
      const track = cameraStore.getPossibleTrack(selectedTrackId.value, selectedCamera.value);
      if (track) {
        // newDetectionMode is true if there's no keyframe on frameNum
        const { features, interpolate } = track.canInterpolate(frameNum);
        const [real] = features;

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
      const track = cameraStore.getPossibleTrack(selectedTrackId.value, selectedCamera.value);
      if (track) {
        recipes.forEach((r) => {
          if (r.active.value) {
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
      const track = cameraStore.getPossibleTrack(selectedTrackId.value, selectedCamera.value);
      if (track) {
        const { frame } = aggregateController.value;
        recipes.forEach((r) => {
          if (r.active.value) {
            r.delete(frame.value, track, selectedKey.value, annotationModes.editing);
          }
        });
        _nudgeEditingCanary();
      }
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
      selectTrack(selectedTrackId.value, true);
      recipes.forEach((r) => {
        if (recipeName !== r.name) {
          r.deactivate();
        }
      });
    }
  }

  recipes.forEach((r) => r.bus.$on('activate', handleSetAnnotationState));
  /* Unsubscribe before unmount */
  onBeforeUnmount(() => {
    recipes.forEach((r) => r.bus.$off('activate', handleSetAnnotationState));
  });

  return {
    editingMode,
    editingDetails,
    selectedFeatureHandle,
    selectedKey,
    visibleModes,
    editHandler: {
      updateRectBounds: handleUpdateRectBounds,
      updateGeoJSON: handleUpdateGeoJSON,
      removePoint: handleRemovePoint,
      removeAnnotation: handleRemoveAnnotation,
      selectFeatureHandle: handleSelectFeatureHandle,
      setAnnotationState: handleSetAnnotationState,
    },
  };
}
