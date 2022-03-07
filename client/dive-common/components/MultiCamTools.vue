<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import {
  useDatasetId, useHandler, useSelectedCamera, useSelectedTrackId, useTrackMap,
} from 'vue-media-annotator/provides';

export default defineComponent({
  name: 'MultiCamTools',
  description: 'MultiCamera Tools',
  setup() {
    const datasetId = useDatasetId();
    const handler = useHandler();
    const selectedCamera = useSelectedCamera();
    const selectedTrackId = useSelectedTrackId();
    const trackMap = useTrackMap();

    const currentMap = computed(() => trackMap.get(selectedCamera.value));

    const currentTrack = computed(() => {
      if (currentMap.value !== undefined && selectedTrackId.value !== null) {
        return currentMap.value.get(selectedTrackId.value);
      }
      return undefined;
    });

    return {
      selectedCamera,
      selectedTrackId,
      currentTrack,
    };
  },
});
</script>

<template>
  <div>
    <v-alert
      type="info"
      tile
    >
      <h4>
        Camera: {{ selectedCamera }}
      </h4>
    </v-alert>
    <v-list>
    </v-list>
  </div>
</template>
