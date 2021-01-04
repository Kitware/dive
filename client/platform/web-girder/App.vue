<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { provideApi } from 'viame-web-common/apispec';
import { GirderDataset } from './store/Dataset';
import {
  getAttributes,
  setAttribute,
  deleteAttribute,
  getPipelineList,
  runPipeline,
  getTrainingConfigurations,
  runTraining,
  saveMetadata,
} from './api/viame.service';
import {
  loadDetections,
  saveDetections,
} from './api/viameDetection.service';

export default defineComponent({
  name: 'App',
  components: {},
  setup(_, { root }) {
    async function loadMetadata(datasetId: string) {
      const dataset: GirderDataset = await root.$store.dispatch('Dataset/load', datasetId);
      return dataset.meta;
    }

    provideApi({
      getAttributes,
      setAttribute,
      deleteAttribute,
      getPipelineList,
      runPipeline,
      getTrainingConfigurations,
      runTraining,
      loadDetections,
      saveDetections,
      loadMetadata,
      saveMetadata,
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
