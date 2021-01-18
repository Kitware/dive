<script lang="ts">
import { defineComponent } from '@vue/composition-api';

import Viewer from 'viame-web-common/components/Viewer.vue';
import RunPipelineMenu from 'viame-web-common/components/RunPipelineMenu.vue';
import JobTab from './JobTab.vue';

import { datasets } from '../store/dataset';

export default defineComponent({
  components: {
    JobTab,
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
      <span
        v-if="datasets[id]"
        class="title pl-3"
      >
        {{ datasets[id].name }}
      </span>
    </template>
    <template #title-right>
      <RunPipelineMenu :selected-dataset-ids="[id]" />
    </template>
  </Viewer>
</template>
