<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { provideApi } from 'viame-web-common/apispec';
import type { GirderMetadata } from './constants';
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
    async function loadMetadata(datasetId: string): Promise<GirderMetadata> {
      return root.$store.dispatch('Dataset/load', datasetId);
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
