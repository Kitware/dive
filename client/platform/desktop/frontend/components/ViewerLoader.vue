<script lang="ts">
import { computed, defineComponent, ref } from '@vue/composition-api';

import Viewer from 'dive-common/components/Viewer.vue';
import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import ImportAnnotations from 'dive-common//components/ImportAnnotations.vue';

import Export from './Export.vue';
import JobTab from './JobTab.vue';

import { datasets } from '../store/dataset';
import { settings } from '../store/settings';

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
    const currentId = ref(props.id);
    const subTypeList = computed(() => [datasets.value[currentId.value]?.subType || null]);
    const readonlyMode = computed(() => settings.value?.readonlyMode || false);
    const updateId = (id: string) => {
      currentId.value = id;
    };

    return {
      currentId,
      datasets,
      viewerRef,
      buttonOptions,
      menuOptions,
      subTypeList,
      readonlyMode,
      updateId,
    };
  },
});
</script>

<template>
  <Viewer
    ref="viewerRef"
    v-bind="{ id, readonlyMode }"
    @updateId="updateId"
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
        :selected-dataset-ids="[currentId]"
        :sub-type-list="subTypeList"
        v-bind="{ buttonOptions, menuOptions }"
      />
      <ImportAnnotations
        :dataset-id="currentId"
        v-bind="{ buttonOptions, menuOptions }"
        block-on-unsaved
      />
      <Export
        v-if="datasets[id]"
        :id="currentId"
        :button-options="buttonOptions"
      />
    </template>
  </Viewer>
</template>
