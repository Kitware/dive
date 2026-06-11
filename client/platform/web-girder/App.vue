<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { provideApi } from 'dive-common/apispec';
import { useDataset } from 'platform/web-girder/store/useDataset';
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
import {
  getLastCalibration,
  openFromDiskWithRegistry,
  saveCalibration,
} from './multicamFileRegistry';

export default defineComponent({
  name: 'App',
  components: {},
  setup() {
    const { loadDataset } = useDataset();
    async function loadMetadata(datasetId: string): Promise<GirderMetadata> {
      return loadDataset(datasetId);
    }

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
      openFromDisk: openFromDiskWithRegistry,
      getLastCalibration,
      saveCalibration,
      importAnnotationFile,
      getTiles,
      getTileURL,
    });
  },
});
</script>

<style lang="scss">
@import 'dive-common/vuetify/v2-compat.scss';

html {
  overflow-y: auto;
}

.text-xs-center {
  text-align: center !important;
}
</style>
