<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { provideApi } from 'dive-common/apispec';
import { useRoute } from 'vue-router/composables';
import { useStore } from 'platform/web-girder/store/types';
import type { GirderMetadata } from './constants';
import {
  getPipelineList,
  deleteTrainedPipeline,
  runPipeline,
  exportTrainedPipeline,
  getTrainingConfigurations,
  runTraining,
  saveMetadata,
  saveAttributes,
  saveAttributeTrackFilters,
  importAnnotationFile,
  loadDetections,
  saveDetections,
  unwrap,
  getTiles,
  getTileURL,
} from './api';
import { openFromDisk } from './utils';

export default defineComponent({
  name: 'App',
  components: {},
  setup() {
    const route = useRoute();
    const store = useStore();
    async function loadMetadata(datasetId: string): Promise<GirderMetadata> {
      return store.dispatch('Dataset/load', datasetId);
    }

    store.dispatch('Location/setLocationFromRoute', route);

    provideApi({
      getPipelineList: unwrap(getPipelineList),
      deleteTrainedPipeline: unwrap(deleteTrainedPipeline),
      runPipeline: unwrap(runPipeline),
      exportTrainedPipeline: unwrap(exportTrainedPipeline),
      getTrainingConfigurations: unwrap(getTrainingConfigurations),
      runTraining: unwrap(runTraining),
      loadDetections,
      saveDetections: unwrap(saveDetections),
      saveMetadata: unwrap(saveMetadata),
      saveAttributes: unwrap(saveAttributes),
      saveAttributeTrackFilters: unwrap(saveAttributeTrackFilters),
      loadMetadata,
      openFromDisk,
      importAnnotationFile,
      getTiles,
      getTileURL,
    });
  },
});
</script>

<style lang="scss">
html {
  overflow-y: auto;
}

.text-xs-center {
  text-align: center !important;
}
</style>
