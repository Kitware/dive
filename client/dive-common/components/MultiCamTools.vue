<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import {
  useCamMap, useHandler, useSelectedCamera,
  useSelectedTrackId, useTime,
} from 'vue-media-annotator/provides';

import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';
import { getTrack } from 'vue-media-annotator/use/useTrackStore';
import { TrackId } from 'vue-media-annotator/track';

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
    const handler = useHandler();
    const { frame } = useTime();
    const selectedTrackId = useSelectedTrackId();
    const camMap = useCamMap();
    const cameras = computed(() => [...camMap.keys()]);
    const tracks = computed(() => {
      const trackKeyPair: Record<string, CameraTrackData> = {};
      if (selectedTrackId.value && selectedCamera.value) {
        camMap.forEach((trackMap, key) => {
          trackKeyPair[key] = {
            trackExists: !!trackMap.get(selectedTrackId.value as TrackId),
            annotationExists: !!trackMap.get(
                selectedTrackId.value as TrackId,
            )?.getFeature(frame.value)[0],
          };
        });
      }
      return trackKeyPair;
    });

    // Delete annotation for selected camera/frame
    const deleteAnnotation = (camera: string, trackId: number) => {
      const track = getTrack(camMap, trackId, camera);
      // If it is the only keyframe we need to remove the track from the camMap
      if (track.length === 1) {
        // Disable prompt for deleting trackk from camMap
        handler.removeTrack([trackId], true, camera);
      } else {
        track.toggleKeyframe(frame.value);
      }
    };

    // To force it into edit/create mode we can select the camera while in
    // editing mode for the selected Track.
    const editOrCreateAnnotation = (camera: string) => {
      handler.setSelectedCamera(camera, true);
    };


    /** So for linking cameras we need to kick it out of the selectedTrack and choose a track within
     * the selected camera to merge with it.  We need to make sure that the merged
     * track only exists on the sleected camera
    **/


    return {
      selectedCamera,
      selectedTrackId,
      frame,
      cameras,
      tracks,
      editOrCreateAnnotation,
      deleteAnnotation,
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
            <h2>{{ camera }}</h2>
          </v-row>
          <v-divider />
          <v-row class="pl-2">
            <h3> Detection: </h3>
            <tooltip-btn
              color="error"
              icon="mdi-delete"
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
              @click="handler.removeTrack([selectedTrackId], true, camera)"
            />
            <tooltip-btn
              v-if="tracks[camera].trackExists"
              color="error"
              icon="mdi-link-variant-minus"
              :tooltip-text="`Unlink Track for camera: ${camera}`"
              @click="handler.unlinkCameraTrack(selectedTrackId, camera)"
            />
            <tooltip-btn
              v-else-if="!tracks[camera].trackExists"
              icon="mdi-link-variant-plus"
              :tooltip-text="`Add Track to this camera: ${camera}`"
            />
          </v-row>
          <v-divider />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
</style>
