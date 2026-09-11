<template>
  <v-app>
    <router-view :key="accountId" />
    <ScoringDatasetPickerDialog />
  </v-app>
</template>

<script lang="ts">
import { computed, defineComponent, watch } from 'vue';
import { clearReviewSession } from 'dive-common/review/reviewSession';
import { provideApi } from 'dive-common/apispec';
import { useRoute } from 'vue-router/composables';
import { useDataset } from 'platform/web-girder/store/useDataset';
import { useLocation } from 'platform/web-girder/store/useLocation';
import { clearMultiCamMetaCache } from './api/multicamResolve';
import { useGirderRest } from './plugins/girder';
import type { GirderConfig } from './constants';
import {
  getPipelineList,
  deleteTrainedPipeline,
  runPipeline,
  watchPipelineJob,
  exportTrainedPipeline,
  getDatasetCalibration,
  loadFrameMetadata,
  getTrainingConfigurations,
  runTraining,
  saveConfig,
  loadGlobalStyleSettings,
  saveGlobalStyleSettings,
  saveAttributes,
  saveAttributeTrackFilters,
  importAnnotationFile,
  importCameraRegistration,
  loadDetections,
  loadReviewTracks,
  loadDatasetConfig,
  saveDetections,
  unwrap,
  getTiles,
  getTileURL,
  getTileHistogram,
  hasCalibrationFile,
  downloadCalibration,
  deleteCalibration,
  runScoring,
  watchScoringJob,
  listScoringResults,
  loadScoringResult,
  deleteScoringResult,
  listScoringSources,
  listScoringDatasets,
  saveScoringExport,
  exportScoringPdf,
  pickScoringDataset,
} from './api';
import ScoringDatasetPickerDialog from './components/ScoringDatasetPickerDialog.vue';
import {
  getLastCalibration,
  openFromDiskWithRegistry,
  saveCalibration,
  stashCalibrationFile,
  stashTransformFile,
  importCalibrationFile,
} from './multicamFileRegistry';
import { reportHandledPromiseRejection } from './reportHandledPromiseRejection';

export default defineComponent({
  name: 'App',
  components: { ScoringDatasetPickerDialog },
  setup() {
    const girderRest = useGirderRest();
    const accountId = computed(() => girderRest.user?._id || '');
    watch(accountId, () => {
      clearReviewSession();
      clearMultiCamMetaCache();
    });
    const route = useRoute();
    const { loadDataset } = useDataset();
    const { setLocationFromRoute } = useLocation();
    async function loadConfig(datasetId: string): Promise<GirderConfig> {
      return loadDataset(datasetId);
    }

    setLocationFromRoute(route).catch((reason) => {
      reportHandledPromiseRejection('App: setLocationFromRoute', reason);
    });

    provideApi({
      getPipelineList: unwrap(getPipelineList),
      deleteTrainedPipeline: unwrap(deleteTrainedPipeline),
      runPipeline: unwrap(runPipeline),
      watchPipelineJob,
      exportTrainedPipeline: unwrap(exportTrainedPipeline),
      getDatasetCalibration: unwrap(getDatasetCalibration),
      downloadCalibration,
      deleteCalibration,
      getTrainingConfigurations: unwrap(getTrainingConfigurations),
      runTraining: unwrap(runTraining),
      loadDetections,
      loadReviewTracks,
      loadFrameMetadata,
      saveDetections: unwrap(saveDetections),
      saveConfig: unwrap(saveConfig),
      loadGlobalStyleSettings,
      saveGlobalStyleSettings,
      saveAttributes: unwrap(saveAttributes),
      saveAttributeTrackFilters: unwrap(saveAttributeTrackFilters),
      loadConfig,
      peekConfig: loadDatasetConfig,
      hasCalibrationFile,
      openFromDisk: openFromDiskWithRegistry,
      getLastCalibration,
      saveCalibration,
      stashCalibrationFile,
      stashTransformFile,
      importCalibrationFile,
      importAnnotationFile,
      importCameraRegistration,
      getTiles,
      getTileURL,
      getTileHistogram,
      runScoring: unwrap(runScoring),
      watchScoringJob,
      listScoringResults: unwrap(listScoringResults),
      loadScoringResult: unwrap(loadScoringResult),
      deleteScoringResult,
      listScoringSources: unwrap(listScoringSources),
      listScoringDatasets,
      pickScoringDataset,
      saveScoringExport,
      exportScoringPdf,
    });
    return { accountId };
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
