<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { provideApi } from 'dive-common/apispec';
import { useRoute } from 'vue-router/composables';
import { useDataset } from 'platform/web-girder/store/useDataset';
import { useLocation } from 'platform/web-girder/store/useLocation';
import type { GirderMetadata } from './constants';
import {
  getPipelineList,
  deleteTrainedPipeline,
  runPipeline,
  exportTrainedPipeline,
  getDatasetCalibration,
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
import {
  getLastCalibration,
  openFromDiskWithRegistry,
  saveCalibration,
  stashCalibrationFile,
} from './multicamFileRegistry';
import { reportHandledPromiseRejection } from './reportHandledPromiseRejection';

export default defineComponent({
  name: 'App',
  components: {},
  setup() {
    const route = useRoute();
    const { loadDataset } = useDataset();
    const { setLocationFromRoute } = useLocation();
    async function loadMetadata(datasetId: string): Promise<GirderMetadata> {
      return loadDataset(datasetId);
    }

    setLocationFromRoute(route).catch((reason) => {
      reportHandledPromiseRejection('App: setLocationFromRoute', reason);
    });

    provideApi({
      getPipelineList: unwrap(getPipelineList),
      deleteTrainedPipeline: unwrap(deleteTrainedPipeline),
      runPipeline: unwrap(runPipeline),
      exportTrainedPipeline: unwrap(exportTrainedPipeline),
      getDatasetCalibration: unwrap(getDatasetCalibration),
      getTrainingConfigurations: unwrap(getTrainingConfigurations),
      runTraining: unwrap(runTraining),
      loadDetections,
      saveDetections: unwrap(saveDetections),
      saveMetadata: unwrap(saveMetadata),
      saveAttributes: unwrap(saveAttributes),
      saveAttributeTrackFilters: unwrap(saveAttributeTrackFilters),
      loadMetadata,
      openFromDisk: openFromDiskWithRegistry,
      getLastCalibration,
      saveCalibration,
      stashCalibrationFile,
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
