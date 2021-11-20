<script lang="ts">
import {
  computed,
  defineComponent, onBeforeUnmount, onMounted, ref, toRef,
} from '@vue/composition-api';

import Viewer from 'dive-common/components/Viewer.vue';
import NavigationTitle from 'dive-common/components/NavigationTitle.vue';
import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import ImportAnnotations from 'dive-common/components/ImportAnnotations.vue';
import { useStore } from 'platform/web-girder/store/types';
import JobsTab from './JobsTab.vue';
import Export from './Export.vue';
import Clone from './Clone.vue';
import ViewerAlert from './ViewerAlert.vue';

const buttonOptions = {
  text: true,
  color: 'grey lighten-1',
  outlined: true,
  depressed: true,
  class: ['mx-1'],
};

const menuOptions = {
  offsetY: true,
  bottom: true,
};

/**
 * ViewerLoader is responsible for loading
 * data from girder.
 */
export default defineComponent({
  components: {
    Clone,
    Export,
    JobsTab,
    RunPipelineMenu,
    NavigationTitle,
    Viewer,
    ImportAnnotations,
    ViewerAlert,
  },

  props: {
    id: {
      type: String,
      required: true,
    },
    revision: {
      type: String,
      default: undefined,
    },
  },

  // TODO: This will require an import from vue-router for Vue3 compatibility
  async beforeRouteLeave(to, from, next) {
    if (await this.viewerRef.navigateAwayGuard()) {
      next();
    }
  },

  setup(props) {
    const viewerRef = ref();
    const store = useStore();
    const brandData = toRef(store.state.Brand, 'brandData');
    const revisionNum = computed(() => {
      const parsed = Number.parseInt(props.revision, 10);
      if (Number.isNaN(parsed)) return undefined;
      return parsed;
    });
    const { getters } = store;

    onMounted(() => {
      window.addEventListener('beforeunload', viewerRef.value.warnBrowserExit);
    });

    onBeforeUnmount(() => {
      window.removeEventListener('beforeunload', viewerRef.value.warnBrowserExit);
    });

    return {
      buttonOptions,
      brandData,
      menuOptions,
      revisionNum,
      viewerRef,
      getters,
    };
  },
});
</script>

<template>
  <Viewer
    :id="id"
    :key="id + revisionNum"
    ref="viewerRef"
    :revision="revisionNum"
  >
    <template #title>
      <ViewerAlert />
      <NavigationTitle :name="brandData.name" />
      <v-tabs
        icons-and-text
        hide-slider
        class="mx-2"
        style="flex-basis:0; flex-grow:0;"
      >
        <v-tab :to="getters['Location/locationRoute']">
          Data
          <v-icon>mdi-database</v-icon>
        </v-tab>
        <JobsTab />
      </v-tabs>
    </template>
    <template #title-right>
      <RunPipelineMenu
        v-bind="{ buttonOptions, menuOptions }"
        :selected-dataset-ids="[id]"
      />
      <ImportAnnotations
        v-bind="{ buttonOptions, menuOptions }"
        :dataset-id="id"
        block-on-unsaved
      />
      <Export
        v-bind="{ buttonOptions, menuOptions }"
        :dataset-id="id"
        block-on-unsaved
      />
      <Clone
        v-if="$store.state.Dataset.meta"
        v-bind="{ buttonOptions, menuOptions }"
        :dataset-id="id"
        :revision="revisionNum"
      />
    </template>
  </Viewer>
</template>
