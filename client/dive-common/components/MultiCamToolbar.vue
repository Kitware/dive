<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
  watch,
} from 'vue';
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
import { Mousetrap } from 'vue-media-annotator/types';

interface ToolbarButton {
  id: string;
  icon: string;
  tooltip: string;
  action?: () => void;
  disabled?: boolean;
  color?: string;
  menu?: { items: Array<{ label: string; action: () => void }> };
}

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
    const STORAGE_KEY = 'multiCamToolbar.expanded';

    // Load from localStorage or default to true
    const loadExpandedState = (): boolean => {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored !== null ? stored === 'true' : true;
    };

    const isExpanded = ref(loadExpandedState());

    // Save to localStorage when state changes
    watch(isExpanded, (value) => {
      localStorage.setItem(STORAGE_KEY, String(value));
    });

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

    // Can unlink when current camera has track and multiple cameras have the track
    const canUnlink = computed(
      () => currentCameraHasTrack.value && camerasWithTrack.value > 1,
    );

    // Can link when there are cameras without the track
    const canLink = computed(() => linkableCameras.value.length > 0);

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

    const toggleExpanded = () => {
      isExpanded.value = !isExpanded.value;
    };

    const toolbarButtons = computed((): ToolbarButton[] => {
      // Ensure reactivity by accessing canary
      _depend();
      const buttons: ToolbarButton[] = [
        {
          id: 'edit-opposite',
          icon: 'mdi-pencil-plus',
          tooltip: `Edit detection on ${oppositeCamera.value} (e)`,
          action: editOnOppositeCamera,
        },
      ];

      if (canLink.value) {
        buttons.push({
          id: 'link',
          icon: 'mdi-link-variant-plus',
          tooltip: 'Link track to camera',
          menu: {
            items: linkableCameras.value.map((cam) => ({
              label: `Link to ${cam}`,
              action: () => startLinkingToCamera(cam),
            })),
          },
        });
      } else {
        buttons.push({
          id: 'unlink',
          icon: 'mdi-link-variant-minus',
          tooltip: 'Unlink track from current camera',
          action: unlinkCurrentCamera,
          disabled: !canUnlink.value,
          color: canUnlink.value ? 'warning' : undefined,
        });
      }

      buttons.push(
        {
          id: 'delete-detection',
          icon: 'mdi-star-minus',
          tooltip: 'Delete detection from current camera',
          action: deleteDetection,
          disabled: !currentCameraHasDetection.value,
        },
        {
          id: 'delete-track',
          icon: 'mdi-delete',
          tooltip: 'Delete track from current camera',
          action: deleteTrackFromCamera,
          disabled: !currentCameraHasTrack.value,
          color: currentCameraHasTrack.value ? 'error' : undefined,
        },
      );

      return buttons;
    });

    // Create a key for the menu to force re-render when buttons change
    const menuKey = computed(() => {
      _depend();
      return `${selectedTrackId.value}-${toolbarButtons.value.length}-${canLink.value}-${canUnlink.value}`;
    });

    const mousetrap: Mousetrap[] = [
      { bind: 'e', handler: editOnOppositeCamera },
    ];

    return {
      mousetrap,
      selectedTrackId,
      selectedCamera,
      cameras,
      cameraTrackInfo,
      camerasWithTrack,
      currentCameraHasTrack,
      currentCameraHasDetection,
      linkableCameras,
      canUnlink,
      canLink,
      oppositeCamera,
      deleteDetection,
      deleteTrackFromCamera,
      unlinkCurrentCamera,
      startLinkingToCamera,
      editOnCamera,
      editOnOppositeCamera,
      isExpanded,
      toggleExpanded,
      toolbarButtons,
      menuKey,
    };
  },
});
</script>

<template>
  <span
    v-if="selectedTrackId !== null && cameras.length > 1"
    v-mousetrap="mousetrap"
    class="pb-1"
  >
    <!-- Dropdown mode when collapsed -->
    <v-menu
      v-if="!isExpanded"
      :key="menuKey"
      offset-y
      :close-on-content-click="false"
    >
      <template #activator="{ on, attrs }">
        <v-btn
          v-bind="attrs"
          class="mx-1 mode-button"
          small
          v-on="on"
        >
          <v-icon>mdi-image-multiple</v-icon>
          <v-btn
            icon
            x-small
            class="ml-1 expand-toggle"
            @click.stop="toggleExpanded"
          >
            <v-icon small>mdi-chevron-right</v-icon>
          </v-btn>
        </v-btn>
      </template>
      <v-list dense>
        <v-list-item
          v-for="button in toolbarButtons"
          :key="`${button.id}-menu`"
        >
          <v-list-item-icon>
            <v-btn
              v-if="!button.menu"
              :color="button.color"
              :disabled="button.disabled"
              class="mx-1 mode-button"
              small
              @click="button.action"
            >
              <v-icon>{{ button.icon }}</v-icon>
            </v-btn>
            <v-menu
              v-else
              offset-y
            >
              <template #activator="{ on: menuOn, attrs: menuAttrs }">
                <v-btn
                  v-bind="menuAttrs"
                  class="mx-1 mode-button"
                  small
                  v-on="menuOn"
                >
                  <v-icon>{{ button.icon }}</v-icon>
                </v-btn>
              </template>
              <v-list dense>
                <v-list-item
                  v-for="item in button.menu.items"
                  :key="item.label"
                  @click="item.action"
                >
                  <v-list-item-content>
                    <v-list-item-title>{{ item.label }}</v-list-item-title>
                  </v-list-item-content>
                </v-list-item>
              </v-list>
            </v-menu>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>{{ button.tooltip }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </v-list>
    </v-menu>

    <!-- Full button mode when expanded -->
    <template v-else>
      <span class="mr-1 px-3 py-1">
        <v-icon class="pr-1">
          mdi-image-multiple
        </v-icon>
        <span class="text-subtitle-2">
          Multi-Cam Tools
        </span>
        <v-btn
          icon
          x-small
          class="ml-1 mr-0 mr-0 expand-toggle"
          @click="toggleExpanded"
        >
          <v-icon small class="mr-0">mdi-chevron-left</v-icon>
        </v-btn>
      </span>
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
        <span>Edit detection on {{ oppositeCamera }} (e)</span>
      </v-tooltip>

      <!-- Link/Unlink button - switches between modes -->
      <!-- Link mode: when there are cameras without the track -->
      <v-menu
        v-if="canLink"
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
      <!-- Unlink mode: when current camera has track and multiple cameras have it -->
      <v-tooltip
        v-else
        bottom
      >
        <template #activator="{ on }">
          <v-btn
            small
            class="mx-1 mode-button"
            :color="canUnlink ? 'warning' : undefined"
            :disabled="!canUnlink"
            v-on="on"
            @click="unlinkCurrentCamera"
          >
            <v-icon>mdi-link-variant-minus</v-icon>
          </v-btn>
        </template>
        <span>Unlink track from current camera</span>
      </v-tooltip>

      <!-- Delete detection from current camera -->
      <v-tooltip bottom>
        <template #activator="{ on }">
          <v-btn
            small
            class="mx-1 mode-button"
            :disabled="!currentCameraHasDetection"
            v-on="on"
            @click="deleteDetection"
          >
            <v-icon>mdi-star-minus</v-icon>
          </v-btn>
        </template>
        <span>Delete detection from current camera</span>
      </v-tooltip>

      <!-- Delete track from current camera -->
      <v-tooltip bottom>
        <template #activator="{ on }">
          <v-btn
            small
            class="mx-1 mode-button"
            :color="currentCameraHasTrack ? 'error' : undefined"
            :disabled="!currentCameraHasTrack"
            v-on="on"
            @click="deleteTrackFromCamera"
          >
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </template>
        <span>Delete track from current camera</span>
      </v-tooltip>
    </template>
  </span>
</template>

<style scoped>
.multicam-toolbar {
  flex-shrink: 0;
}
.mode-button {
  border: 1px solid grey;
  min-width: 36px;
}
.expand-toggle {
  opacity: 0.5;
  transition: opacity 0.2s;
}
.expand-toggle:hover {
  opacity: 1;
}
</style>
