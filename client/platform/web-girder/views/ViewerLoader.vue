<script lang="ts">
import {
  defineComponent, onBeforeUnmount, onMounted, ref, toRef,
} from '@vue/composition-api';
import Viewer from 'viame-web-common/components/Viewer.vue';
import RunPipelineMenu from 'viame-web-common/components/RunPipelineMenu.vue';

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

  setup(props, { root }) {
    const viewerRef = ref();
    const brandData = toRef(root.$store.state.Location, 'brandData');
    onMounted(() => {
      window.addEventListener('beforeunload', viewerRef.value.warnBrowserExit);
    });
    onBeforeUnmount(() => {
      window.removeEventListener('beforeunload', viewerRef.value.warnBrowserExit);
    });

    return { viewerRef, brandData };
  },
});
</script>

<template>
  <Viewer
    ref="viewerRef"
    :dataset-id="datasetId"
  >
    <template #title>
      <div class="text-h4 mr-3">
        {{ brandData.name }}
      </div>
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
    </template>
    <template #title-right>
      <RunPipelineMenu :selected-dataset-ids="[id]" />
      <Export :dataset-id="id" />
    </template>
  </Viewer>
</template>
