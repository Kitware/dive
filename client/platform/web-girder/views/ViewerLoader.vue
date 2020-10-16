<script lang="ts">
import { computed, defineComponent, toRef } from '@vue/composition-api';
import Viewer from 'viame-web-common/components/Viewer.vue';
import RunPipelineMenu from 'viame-web-common/components/RunPipelineMenu.vue';

import { getPathFromLocation } from '../utils';
import Export from './Export.vue';

/**
 * ViewerLoader is responsible for loading
 * data from girder.
 */
export default defineComponent({
  components: { Export, RunPipelineMenu, Viewer },

  props: {
    datasetId: {
      type: String,
      required: true,
    },
  },

  setup(props, { root }) {
    const dataset = toRef(root.$store.state.Dataset, 'dataset');
    const frameRate = toRef(root.$store.getters, 'Dataset/frameRate');
    const annotatorType = toRef(root.$store.getters, 'Dataset/annotatorType');
    const imageData = toRef(root.$store.state.Dataset, 'imageData');
    const videoUrl = toRef(root.$store.state.Dataset, 'videoUrl');
    const location = toRef(root.$store.state.Location, 'location');
    const dataPath = computed(() => (
      getPathFromLocation(location.value)));

    return {
      dataPath,
      dataset,
      frameRate,
      annotatorType,
      imageData,
      videoUrl,
    };
  },
});
</script>

<template>
  <Viewer
    :frame-rate="frameRate"
    :annotator-type="annotatorType"
    :image-data="imageData"
    :video-url="videoUrl"
    :dataset-id="datasetId"
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
    <template #title-right>
      <RunPipelineMenu :selected-dataset-ids="[datasetId]" />
      <Export :dataset-id="datasetId" />
    </template>
  </Viewer>
</template>
