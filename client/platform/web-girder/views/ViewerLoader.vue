<script lang="ts">
import { computed, defineComponent, toRef } from '@vue/composition-api';

import Viewer from 'viame-web-common/components/Viewer.vue';
import { provideApi } from 'viame-web-common/apispec';

import {
  getAttributes,
  getPipelineList,
  runPipeline,
  saveMetadata,
} from '../api/viame.service';
import {
  getDetections as loadDetections,
  getExportUrls,
  saveDetections,
} from '../api/viameDetection.service';
import useGirderDataset from '../useGirderDataset';
import Export from './Export.vue';

/**
 * ViewerLoader is responsible for loading
 * data from girder.
 */
export default defineComponent({
  components: { Viewer, Export },

  props: {
    datasetId: {
      type: String,
      required: true,
    },
  },

  setup(props, { root }) {
    const {
      frameRate,
      annotatorType,
      imageData,
      videoUrl,
      loadDataset,
      dataset,
    } = useGirderDataset();

    /* intercept dataset load to set store location */
    async function loadMetadata(id: string) {
      const ds = await loadDataset(id);
      root.$store.commit('Location/setLocation', {
        _id: ds.parentId,
        _modelType: ds.parentCollection,
      });
      return ds.meta;
    }

    provideApi(
      {
        getAttributes,
        getPipelineList,
        runPipeline,
        loadDetections,
        saveDetections,
        loadMetadata,
        saveMetadata,
      },
      toRef(props, 'datasetId'),
    );

    const dataPath = computed(() => (
      getPathFromLocation(ctx.root.$store.state.Location.location)));

    return {
      dataset,
      frameRate,
      annotatorType,
      imageData,
      videoUrl,
    };
  },
})
</script>

<template>
  <Viewer
    :frame-rate="frameRate"
    :annotator-type="annotatorType"
    :image-data="imageData"
    :video-url="videoUrl"
  >
    <template #title>
      <v-tabs
        icons-and-text
        hide-slider
        style="flex-basis:0; flex-grow:0;"
      >
        <v-tab :to="dataPath">
          Data
          <v-icon>mdi-database</v-icon>
        </v-tab>
        <v-tab to="/settings">
          Settings<v-icon>mdi-settings</v-icon>
        </v-tab>
      </v-tabs>
      <span
        v-if="dataset"
        class="title pl-3"
      >
        {{ dataset.name }}
      </span>
    </template>
    <template #title-rigth>
      <export
        v-if="dataset !== null"
        :dataset-id="dataset._id"
      />
    </template>
  </Viewer>
</template>
