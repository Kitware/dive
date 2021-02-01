<script lang="ts">
import { defineComponent } from '@vue/composition-api';

import NavigationTitle from 'viame-web-common/components/NavigationTitle.vue';
import Viewer from 'viame-web-common/components/Viewer.vue';
import RunPipelineMenu from 'viame-web-common/components/RunPipelineMenu.vue';
import JobTab from './JobTab.vue';

import { datasets } from '../store/dataset';

export default defineComponent({
  components: {
    JobTab,
    NavigationTitle,
    RunPipelineMenu,
    Viewer,
  },
  props: {
    id: {
      type: String,
      required: true,
    },
  },
  setup() {
    return { datasets };
  },
});
</script>

<template>
  <Viewer :id="id">
    <template #title>
      <NavigationTitle />
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
          Settings<v-icon>mdi-settings</v-icon>
        </v-tab>
      </v-tabs>
    </template>
    <template #title-right>
      <RunPipelineMenu :selected-dataset-ids="[id]" />
    </template>
  </Viewer>
</template>
