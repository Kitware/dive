<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import {
  useCameraRegistration,
  useCameraStore,
  useDatasetId,
  useEditingMode,
  useHandler,
  useSelectedCamera,
  useSelectedTrackId,
  useTime,
  useTrackFilters,
} from 'vue-media-annotator/provides';
import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import Track from 'vue-media-annotator/track';
import { useApi } from 'dive-common/apispec';
import { pendingFrameShifts, shiftTrackData } from 'dive-common/frameOffsetAnnotations';

interface CameraTrackData {
  trackExists: boolean;
  annotationExists: boolean;
}
export default defineComponent({
  name: 'MultiCamTools',
  description: 'Multi Camera Tools',
  components: { TooltipBtn },
  setup() {
    const selectedCamera = useSelectedCamera();
    const inEditingMode = useEditingMode();
    const enabledTracksRef = useTrackFilters().enabledAnnotations;
    const handler = useHandler();
    const { frame, frameRate } = useTime();
    const selectedTrackId = useSelectedTrackId();
    const cameraStore = useCameraStore();
    const cameras = computed(() => cameraStore.orderedCameraNames());
    const registration = useCameraRegistration();
    const datasetId = useDatasetId();
    const { saveConfig } = useApi();

    // Time offset: the first camera is the reference; every other camera is shifted onto it.
    const OFFSET_LIMIT_SECONDS = 3;
    const referenceCamera = computed(() => cameras.value[0] ?? null);
    const offsetCameras = computed(() => cameras.value.slice(1));
    const offsetLimit = computed(
      () => Math.max(1, Math.round((frameRate.value || 30) * OFFSET_LIMIT_SECONDS)),
    );
    function cameraOffset(camera: string): number {
      return registration.frameOffsets.value[camera] ?? 0;
    }
    function setCameraOffset(camera: string, value: number) {
      // Replace the map: the aligned timeline is a computed over this ref.
      registration.frameOffsets.value = {
        ...registration.frameOffsets.value,
        [camera]: Math.round(value),
      };
    }
    function nudgeOffset(camera: string, delta: number) {
      setCameraOffset(camera, cameraOffset(camera) + delta);
    }
    function offsetReadout(camera: string): string {
      const frames = cameraOffset(camera);
      const sign = frames > 0 ? '+' : '';
      const plural = Math.abs(frames) === 1 ? '' : 's';
      const seconds = frameRate.value ? ` (${sign}${(frames / frameRate.value).toFixed(3)}s)` : '';
      return `${sign}${frames} frame${plural}${seconds}`;
    }
    const pendingShifts = computed(() => pendingFrameShifts(
      registration.frameOffsets.value,
      registration.appliedFrameOffsets.value,
      offsetCameras.value,
    ));
    const savingOffsets = ref(false);
    /** Move each shifted camera's annotations by its unapplied offset, then save everything. */
    async function saveAnnotationOffsets() {
      savingOffsets.value = true;
      try {
        Object.entries(pendingShifts.value).forEach(([camera, delta]) => {
          const store = cameraStore.camMap.value.get(camera)?.trackStore;
          if (!store) {
            return;
          }
          const tracks = Array.from(store.annotationMap.values()) as Track[];
          tracks.forEach((track) => {
            const shifted = shiftTrackData(track.serialize(), delta);
            store.remove(track.id, shifted !== null);
            if (shifted !== null) {
              store.insert(Track.fromJSON(shifted, track.set));
            }
          });
        });
        registration.appliedFrameOffsets.value = { ...registration.frameOffsets.value };
        await saveConfig(datasetId.value, {
          cameraFrameOffsets: registration.frameOffsets.value,
          cameraFrameOffsetsApplied: registration.appliedFrameOffsets.value,
        });
        registration.markSaved();
        await handler.save();
      } finally {
        savingOffsets.value = false;
      }
    }
    const canary = ref(false);
    function _depend(): boolean {
      return canary.value;
    }
    const tracks = computed(() => {
      const trackKeyPair: Record<string, CameraTrackData> = {};
      _depend(); // Used for remove detections/tracks from a camera
      /* EnabledTracksRef depedency triggers update when the sortedTracks updates based
       * on track links/unlinks.  It doesn't work on same frame camera track deletions because
       * nothing is updated in the sortedTracks dependencies when that happens
       */
      if (
        selectedTrackId.value !== null
        && selectedCamera.value
        && enabledTracksRef.value.length > 0
      ) {
        cameraStore.camMap.value.forEach((camera, key) => {
          const trackExists = camera.trackStore.getPossible(selectedTrackId.value as AnnotationId);
          const completeTrackExists = trackExists !== undefined && trackExists.features.length > 0;
          trackKeyPair[key] = {
            trackExists: completeTrackExists,
            annotationExists:
              completeTrackExists
              && camera.trackStore
                .get(selectedTrackId.value as AnnotationId)
                ?.getFeature(frame.value)[0] !== null,
          };
        });
      }
      return trackKeyPair;
    });
    const existingCount = computed(
      () => Object.values(tracks.value).filter((item) => item.trackExists).length,
    );
    // Delete annotation for selected camera/frame
    const deleteAnnotation = async (camera: string, trackId: number) => {
      canary.value = !canary.value;
      const track = cameraStore.getTrack(trackId, camera);
      const allTracks = cameraStore.getTrackAll(trackId);
      // If it is the only keyframe we need to remove the track from the camMap
      if (track.length === 1) {
        // Disable prompt for deleting trackk from camMap if there are other tracks on other cameras
        await handler.removeTrack([trackId], allTracks.length > 1, camera);
        if (allTracks.length === 1) {
          handler.trackSelect(null, false);
        }
      } else {
        track.toggleKeyframe(frame.value);
      }
    };
    // Delete entire track, only confirm if it is the only track.
    const deleteTrack = async (camera: string, trackId: number) => {
      canary.value = !canary.value;
      const allTracks = cameraStore.getTrackAll(trackId);
      await handler.removeTrack([trackId], allTracks.length > 1, camera);
      if (allTracks.length === 1) {
        handler.trackSelect(null, false);
      }
    };
    // To force it into edit/create mode we can select the camera while in
    // editing mode for the selected Track.
    const editOrCreateAnnotation = (camera: string) => {
      handler.selectCamera(camera, true);
    };
    /** So for linking cameras we need to kick it out of the selectedTrack and choose a track within
     * the selected camera to merge with it.  We need to make sure that the merged
     * track only exists on the sleected camera
     **/
    const startLinking = (camera: string) => {
      //We can't join the other track while in editing mode so we need to disable it
      if (inEditingMode.value) {
        handler.trackSelect(selectedTrackId.value, false);
      }
      if (selectedCamera.value !== camera) {
        handler.selectCamera(camera, false);
      }
      handler.startLinking(camera);
    };
    return {
      selectedCamera,
      selectedTrackId,
      existingCount,
      frame,
      cameras,
      tracks,
      editOrCreateAnnotation,
      deleteAnnotation,
      deleteTrack,
      startLinking,
      handler,
      referenceCamera,
      offsetCameras,
      offsetLimit,
      cameraOffset,
      setCameraOffset,
      nudgeOffset,
      offsetReadout,
      pendingShifts,
      savingOffsets,
      saveAnnotationOffsets,
    };
  },
});
</script>

<template>
  <div class="mx-4">
    <span class="text-body-2">
      Multi Camera Tools for creating tracks, linking and unlinking tracks
    </span>
    <v-divider class="my-3" />
    <div v-if="offsetCameras.length">
      <h4>Time Offset</h4>
      <span class="text-caption grey--text d-block mb-1">
        Frames to shift each camera so it plays in step with {{ referenceCamera }}.
      </span>
      <div v-for="camera in offsetCameras" :key="camera" class="mb-2">
        <span class="text-body-2">{{ camera }}</span>
        <div class="d-flex align-center">
          <tooltip-btn
            icon="mdi-minus"
            :tooltip-text="`Shift ${camera} one frame earlier`"
            @click="nudgeOffset(camera, -1)"
          />
          <v-slider
            :value="cameraOffset(camera)"
            :min="-offsetLimit"
            :max="offsetLimit"
            :step="1"
            dense
            hide-details
            class="mx-1"
            @input="setCameraOffset(camera, $event)"
          />
          <tooltip-btn
            icon="mdi-plus"
            :tooltip-text="`Shift ${camera} one frame later`"
            @click="nudgeOffset(camera, 1)"
          />
        </div>
        <div class="text-caption" style="font-family: monospace;">
          {{ offsetReadout(camera) }}
        </div>
      </div>
      <v-btn
        block
        small
        color="primary"
        :disabled="!Object.keys(pendingShifts).length"
        :loading="savingOffsets"
        @click="saveAnnotationOffsets"
      >
        Save annotations
      </v-btn>
      <span class="text-caption grey--text d-block mt-1">
        Moves every annotation on a shifted camera by its offset, then saves.
      </span>
    </div>
    <v-divider class="my-3" />
    <div v-if="selectedTrackId !== null">
      <span> Selected Track: {{ selectedTrackId }} Frame: {{ frame }}</span>
      <div>
        <div v-for="camera in cameras" :key="camera" class="pt-3">
          <v-row>
            <h2 :class="{ selected: camera === selectedCamera }">
              {{ camera }}
            </h2>
          </v-row>
          <v-divider />
          <v-row align="center" justify="space-between" class="mt-4 mb-2">
            <h3 class="mb-0">
              Detection:
            </h3>
            <div class="d-flex gap-2">
              <tooltip-btn
                icon="mdi-star"
                :disabled="!tracks[camera].annotationExists"
                :tooltip-text="`Delete detection for camera: ${camera}`"
                @click="deleteAnnotation(camera, selectedTrackId)"
              />
              <tooltip-btn
                v-if="tracks[camera].annotationExists"
                icon="mdi-pencil-box-outline"
                :tooltip-text="`Edit detection for camera: ${camera}`"
                @click="editOrCreateAnnotation(camera)"
              />
              <tooltip-btn
                v-else
                icon="mdi-shape-square-plus"
                :tooltip-text="`Add detection for camera: ${camera}`"
                @click="editOrCreateAnnotation(camera)"
              />
            </div>
          </v-row>

          <v-divider class="my-2" />

          <v-row align="center" justify="space-between" class="mt-2 mb-4">
            <h3 class="mb-0">
              Track:
            </h3>
            <div class="d-flex gap-2">
              <tooltip-btn
                color="error"
                icon="mdi-delete"
                :disabled="!tracks[camera].trackExists"
                :tooltip-text="`Delete Track for camera: ${camera}`"
                @click="deleteTrack(camera, selectedTrackId)"
              />
              <tooltip-btn
                v-if="tracks[camera].trackExists"
                color="error"
                icon="mdi-link-variant-minus"
                :disabled="existingCount === 1"
                :tooltip-text="`Unlink Track for camera: ${camera}`"
                @click="handler.unlinkCameraTrack(selectedTrackId, camera)"
              />
              <tooltip-btn
                v-else
                icon="mdi-link-variant-plus"
                :tooltip-text="`Link Track to this camera: ${camera}`"
                @click="startLinking(camera)"
              />
            </div>
          </v-row>

          <v-divider />
        </div>
      </div>
    </div>
    <div v-else class="text-body-2">
      <p>No track selected.</p>
      <p>This panel is used for:</p>
      <ul>
        <li>Viewing which cameras have tracks/detections for the selected trackId</li>
        <li>Deleting detection and/or tracks from a camera</li>
        <li>Splitting off tracks from an existing camera</li>
        <li>Linking tracks from difference cameras to the same trackId</li>
      </ul>
      <p>Select a track to populate this editor.</p>
    </div>
  </div>
</template>

<style scoped>
.selected {
  border: 2px dashed cyan;
  padding-left: 4px;
  padding-right: 4px;
}
</style>
