<script lang="ts">
import { computed, defineComponent, ref } from '@vue/composition-api';

import Viewer from 'dive-common/components/Viewer.vue';
import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import ImportAnnotations from 'dive-common//components/ImportAnnotations.vue';

import Export from './Export.vue';
import JobTab from './JobTab.vue';

import { datasets } from '../store/dataset';

const buttonOptions = {
  outlined: true,
  color: 'grey lighten-1',
  depressed: true,
  text: true,
  class: ['mx-1'],
};

const menuOptions = {
  offsetY: true,
};

export default defineComponent({
  components: {
    Export,
    JobTab,
    RunPipelineMenu,
    Viewer,
    ImportAnnotations,
  },
  props: {
    id: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const viewerRef = ref();
    const subTypeList = computed(() => [datasets.value[props.id]?.subType || null]);
    return {
      datasets,
      viewerRef,
      buttonOptions,
      menuOptions,
      subTypeList,
    };
  },
});
</script>

<template>
  <Viewer
    :id="id"
    ref="viewerRef"
  >
    <template #title>
      <v-tabs
        icons-and-text
        hide-slider
        style="flex-basis:0; flex-grow:0;"
      >
        <v-tab :to="{ name: 'recent' }">
          Recents
          <v-icon>mdi-folder-open</v-icon>
        </v-tab>
        <job-tab />
        <v-tab :to="{ name: 'training' }">
          Training<v-icon>mdi-brain</v-icon>
        </v-tab>
        <v-tab :to="{ name: 'settings' }">
          Settings<v-icon>mdi-cog</v-icon>
        </v-tab>
      </v-tabs>
    </template>
    <template #title-right>
      <RunPipelineMenu
        :selected-dataset-ids="[id]"
        :sub-type-list="subTypeList"
        v-bind="{ buttonOptions, menuOptions }"
      />
      <ImportAnnotations
        :dataset-id="id"
        v-bind="{ buttonOptions, menuOptions }"
        block-on-unsaved
      />
      <Export
        v-if="datasets[id]"
        :id="id"
        :button-options="buttonOptions"
      />
    </template>
  </Viewer>
</template>
