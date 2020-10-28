<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, ref, toRef,
} from '@vue/composition-api';
import Viewer from 'viame-web-common/components/Viewer.vue';
import RunPipelineMenu from 'viame-web-common/components/RunPipelineMenu.vue';

import { getPathFromLocation } from '../utils';
import Export from './Export.vue';


// TODO:  Needed for refs to work in composition API Plugin, Vue3 will change it
// https://github.com/vuejs/composition-api/blob/master/README.md - $refs section
declare module '@vue/composition-api' {
  interface SetupContext {
    readonly refs: { [key: string]: Vue | Element | Vue[] | Element[] };
  }
}
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
  // TODO: This will require an import from vue-router for Vue3 compatibility
  async beforeRouteLeave(to, from, next) {
    if (await this.viewerRef.navigateAwayGuard()) {
      next();
    }
  },
  setup(props, { root, refs }) {
    const dataset = toRef(root.$store.state.Dataset, 'dataset');
    const frameRate = toRef(root.$store.getters, 'Dataset/frameRate');
    const annotatorType = toRef(root.$store.getters, 'Dataset/annotatorType');
    const imageData = toRef(root.$store.state.Dataset, 'imageData');
    const videoUrl = toRef(root.$store.state.Dataset, 'videoUrl');
    const location = toRef(root.$store.state.Location, 'location');
    const dataPath = computed(() => (
      getPathFromLocation(location.value)));

    const viewerRef = ref();
    onMounted(() => {
      viewerRef.value = refs.viewer;
      window.addEventListener('beforeunload', viewerRef.value.warnBrowserExit);
    });
    onBeforeUnmount(() => {
      window.removeEventListener('beforeunload', viewerRef.value.warnBrowserExit);
    });


    return {
      dataPath,
      dataset,
      frameRate,
      annotatorType,
      imageData,
      videoUrl,
      viewerRef,
    };
  },
});
</script>

<template>
  <Viewer
    ref="viewer"
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
