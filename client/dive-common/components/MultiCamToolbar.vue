<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import {
  useCameraStore,
  useHandler,
  useSelectedCamera,
  useSelectedTrackId,
  useTime,
  useTrackFilters,
  useEditingMode,
} from 'vue-media-annotator/provides';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';

export default defineComponent({
  name: 'MultiCamToolbar',
  setup() {
    const selectedCamera = useSelectedCamera();
    const selectedTrackId = useSelectedTrackId();
    const cameraStore = useCameraStore();
    const handler = useHandler();
    const { frame } = useTime();
    const enabledTracksRef = useTrackFilters().enabledAnnotations;
    const inEditingMode = useEditingMode();

    const cameras = computed(() => [...cameraStore.camMap.value.keys()]);
    const canary = ref(false);

    function _depend(): boolean {
      return canary.value;
    }

    // Get info about which cameras have tracks/detections for selected track
    const cameraTrackInfo = computed(() => {
      const info: Record<string, { hasTrack: boolean; hasDetection: boolean }> = {};
      _depend();
      if (
        selectedTrackId.value !== null
        && selectedCamera.value
        && enabledTracksRef.value.length > 0
      ) {
        cameraStore.camMap.value.forEach((camera, key) => {
          const track = camera.trackStore.getPossible(selectedTrackId.value as AnnotationId);
          const hasTrack = track !== undefined && track.features.length > 0;
          info[key] = {
            hasTrack,
            hasDetection:
              hasTrack
              && camera.trackStore
                .get(selectedTrackId.value as AnnotationId)
                ?.getFeature(frame.value)[0] !== null,
          };
        });
      }
      return info;
    });

    const camerasWithTrack = computed(
      () => Object.entries(cameraTrackInfo.value).filter(([, v]) => v.hasTrack).length,
    );

    const currentCameraHasTrack = computed(
      () => cameraTrackInfo.value[selectedCamera.value]?.hasTrack ?? false,
    );

    const currentCameraHasDetection = computed(
      () => cameraTrackInfo.value[selectedCamera.value]?.hasDetection ?? false,
    );

    // Other cameras that don't have this track (available for linking)
    const linkableCameras = computed(() => cameras.value.filter(
      (cam) => !cameraTrackInfo.value[cam]?.hasTrack,
    ));

    // The opposite camera (first camera that isn't the currently selected one)
    const oppositeCamera = computed(() => cameras.value.find(
      (cam) => cam !== selectedCamera.value,
    ));

    // Delete detection from current camera/frame
    const deleteDetection = async () => {
      if (selectedTrackId.value === null || !selectedCamera.value) return;
      canary.value = !canary.value;
      const track = cameraStore.getTrack(selectedTrackId.value, selectedCamera.value);
      const allTracks = cameraStore.getTrackAll(selectedTrackId.value);
      if (track.length === 1) {
        await handler.removeTrack([selectedTrackId.value], allTracks.length > 1, selectedCamera.value);
        if (allTracks.length === 1) {
          handler.trackSelect(null, false);
        }
      } else {
        track.toggleKeyframe(frame.value);
      }
    };

    // Delete entire track from current camera
    const deleteTrackFromCamera = async () => {
      if (selectedTrackId.value === null || !selectedCamera.value) return;
      canary.value = !canary.value;
      const allTracks = cameraStore.getTrackAll(selectedTrackId.value);
      await handler.removeTrack([selectedTrackId.value], allTracks.length > 1, selectedCamera.value);
      if (allTracks.length === 1) {
        handler.trackSelect(null, false);
      }
    };

    // Unlink current camera from track
    const unlinkCurrentCamera = () => {
      if (selectedTrackId.value === null || !selectedCamera.value) return;
      handler.unlinkCameraTrack(selectedTrackId.value, selectedCamera.value);
      canary.value = !canary.value;
    };

    // Start linking to another camera
    const startLinkingToCamera = (camera: string) => {
      if (inEditingMode.value) {
        handler.trackSelect(selectedTrackId.value, false);
      }
      if (selectedCamera.value !== camera) {
        handler.selectCamera(camera, false);
      }
      handler.startLinking(camera);
    };

    // Edit or create detection on a camera
    const editOnCamera = (camera: string) => {
      handler.selectCamera(camera, true);
    };

    // Edit on the opposite camera
    const editOnOppositeCamera = () => {
      if (oppositeCamera.value) {
        editOnCamera(oppositeCamera.value);
      }
    };

    return {
      selectedTrackId,
      selectedCamera,
      cameras,
      cameraTrackInfo,
      camerasWithTrack,
      currentCameraHasTrack,
      currentCameraHasDetection,
      linkableCameras,
      oppositeCamera,
      deleteDetection,
      deleteTrackFromCamera,
      unlinkCurrentCamera,
      startLinkingToCamera,
      editOnCamera,
      editOnOppositeCamera,
    };
  },
});
</script>

<template>
  <div
    v-if="selectedTrackId !== null && cameras.length > 1"
    class="d-flex align-center multicam-toolbar"
  >
    <!-- Edit/Add detection on opposite camera -->
    <v-tooltip bottom>
      <template #activator="{ on }">
        <v-btn
          small
          class="mx-1 mode-button"
          v-on="on"
          @click="editOnOppositeCamera"
        >
          <v-icon>mdi-pencil-plus</v-icon>
        </v-btn>
      </template>
      <span>Edit detection on {{ oppositeCamera }}</span>
    </v-tooltip>

    <!-- Link to another camera -->
    <v-menu
      v-if="linkableCameras.length > 0"
      offset-y
    >
      <template #activator="{ on, attrs }">
        <v-tooltip bottom>
          <template #activator="{ on: tooltipOn }">
            <v-btn
              v-bind="attrs"
              small
              class="mx-1 mode-button"
              v-on="{ ...on, ...tooltipOn }"
            >
              <v-icon>mdi-link-variant-plus</v-icon>
            </v-btn>
          </template>
          <span>Link track to camera</span>
        </v-tooltip>
      </template>
      <v-list dense>
        <v-list-item
          v-for="camera in linkableCameras"
          :key="camera"
          @click="startLinkingToCamera(camera)"
        >
          <v-list-item-content>
            <v-list-item-title>Link to {{ camera }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </v-list>
    </v-menu>

    <!-- Unlink current camera -->
    <v-tooltip
      v-if="currentCameraHasTrack && camerasWithTrack > 1"
      bottom
    >
      <template #activator="{ on }">
        <v-btn
          small
          class="mx-1 mode-button"
          color="warning"
          v-on="on"
          @click="unlinkCurrentCamera"
        >
          <v-icon>mdi-link-variant-minus</v-icon>
        </v-btn>
      </template>
      <span>Unlink track from current camera</span>
    </v-tooltip>

    <!-- Delete detection from current camera -->
    <v-tooltip
      v-if="currentCameraHasDetection"
      bottom
    >
      <template #activator="{ on }">
        <v-btn
          small
          class="mx-1 mode-button"
          v-on="on"
          @click="deleteDetection"
        >
          <v-icon>mdi-star-minus</v-icon>
        </v-btn>
      </template>
      <span>Delete detection from current camera</span>
    </v-tooltip>

    <!-- Delete track from current camera -->
    <v-tooltip
      v-if="currentCameraHasTrack"
      bottom
    >
      <template #activator="{ on }">
        <v-btn
          small
          class="mx-1 mode-button"
          color="error"
          v-on="on"
          @click="deleteTrackFromCamera"
        >
          <v-icon>mdi-delete</v-icon>
        </v-btn>
      </template>
      <span>Delete track from current camera</span>
    </v-tooltip>
  </div>
</template>

<style scoped>
.multicam-toolbar {
  flex-shrink: 0;
}
.mode-button {
  border: 1px solid grey;
}
</style>
