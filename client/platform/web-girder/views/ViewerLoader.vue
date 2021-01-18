<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, ref, toRef,
} from '@vue/composition-api';
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
    id: {
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
    const meta = toRef(root.$store.state.Dataset, 'meta');
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
      meta,
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
    :id="id"
    ref="viewer"
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
        <v-tab :to="{ name: 'training' }">
          Training
          <v-icon>
            mdi-brain
          </v-icon>
        </v-tab>
        <v-tab to="/settings">
          Settings<v-icon>mdi-settings</v-icon>
        </v-tab>
      </v-tabs>
      <span
        v-if="meta"
        class="title pl-3"
      >
        {{ meta.name }}
      </span>
    </template>
    <template #title-right>
      <RunPipelineMenu :selected-dataset-ids="[id]" />
      <Export :dataset-id="id" />
    </template>
  </Viewer>
</template>
