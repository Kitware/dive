<script lang="ts">
import { computed, defineComponent, ref } from '@vue/composition-api';
import {
  useCameraStore,
  useEditingMode, useHandler, useSelectedCamera,
  useSelectedTrackId, useTime, useTrackFilters,
} from 'vue-media-annotator/provides';
import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';

interface CameraTrackData {
    trackExists: boolean;
    annotationExists: boolean;
}
export default defineComponent({
  name: 'MultiCamTools',
  description: 'MultiCam Tools',
  components: { TooltipBtn },
  setup() {
    const selectedCamera = useSelectedCamera();
    const inEditingMode = useEditingMode();
    const enabledTracksRef = useTrackFilters().enabledAnnotations;
    const handler = useHandler();
    const { frame } = useTime();
    const selectedTrackId = useSelectedTrackId();
    const cameraStore = useCameraStore();
    const cameras = computed(() => [...cameraStore.camMap.value.keys()]);
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
      if (selectedTrackId.value !== null && selectedCamera.value
      && enabledTracksRef.value.length > 0) {
        cameraStore.camMap.value.forEach((camera, key) => {
          const trackExists = camera.trackStore.getPossible(selectedTrackId.value as AnnotationId);
          const completeTrackExists = (trackExists !== undefined
          && trackExists.features.length > 0);
          trackKeyPair[key] = {
            trackExists: completeTrackExists,
            annotationExists: completeTrackExists && camera.trackStore.get(
                selectedTrackId.value as AnnotationId,
            )?.getFeature(frame.value)[0] !== null,
          };
        });
      }
      return trackKeyPair;
    });
    const existingCount = computed(() => Object.values(
      tracks.value,
    ).filter((item) => item.trackExists).length);
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
    };
  },
});
</script>

<template>
  <div class="mx-4">
    <span class="text-body-2">
      Multicam Tools for creating tracks, linking and unlinking tracks
    </span>
    <v-divider class="my-3" />
    <v-divider class="my-3" />
    <div v-if="selectedTrackId !== null">
      <span> Selected Track: {{ selectedTrackId }}  Frame: {{ frame }}</span>
      <div>
        <div
          v-for="camera in cameras"
          :key="camera"
        >
          <v-row>
            <h2 :class="{selected:camera === selectedCamera}">
              {{ camera }}
            </h2>
          </v-row>
          <v-divider />
          <v-row class="pl-2">
            <h3> Detection: </h3>
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
              v-else-if="!tracks[camera].annotationExists"
              icon="mdi-shape-square-plus"
              :tooltip-text="`Add detection for camera: ${camera}`"
              @click="editOrCreateAnnotation(camera)"
            />
          </v-row>
          <v-divider class="pl-2" />
          <v-row class="pl-2">
            <h3> Track: </h3>
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
              v-else-if="!tracks[camera].trackExists"
              icon="mdi-link-variant-plus"
              :tooltip-text="`Link Track to this camera: ${camera}`"
              @click="startLinking(camera)"
            />
          </v-row>
          <v-divider />
        </div>
      </div>
    </div>
    <div
      v-else
      class="text-body-2"
    >
      <p>No track selected.</p>
      <p>
        This panel is used for:
        <ul>
          <li>Viewing which cameras have tracks/detections for the selected trackId</li>
          <li>Deleting detection and/or tracks from a camera </li>
          <li>Splitting off tracks from an existing camera</li>
          <li>Linking tracks from difference cameras to the same trackId</li>
        </ul>
      </p>
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
