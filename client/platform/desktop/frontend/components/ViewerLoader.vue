<script lang="ts">
import {
  computed, defineComponent, ref, watch,
} from '@vue/composition-api';

import Viewer from 'dive-common/components/Viewer.vue';
import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import ImportAnnotations from 'dive-common//components/ImportAnnotations.vue';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import Export from './Export.vue';
import JobTab from './JobTab.vue';

import { datasets } from '../store/dataset';
import { settings } from '../store/settings';

import { runningJobs } from '../store/jobs';

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
    id: { // always the base ID
      type: String,
      required: true,
    },
  },
  setup(props) {
    const { prompt } = usePrompt();
    const viewerRef = ref();
    const compoundId = ref(props.id);
    const subTypeList = computed(() => [datasets.value[props.id]?.subType || null]);
    const readonlyMode = computed(() => settings.value?.readonlyMode || false);

    watch(runningJobs, async (_previous, current) => {
      const index = current.findIndex((item) => item.job.datasetIds.includes(props.id));
      if (index !== -1 && current[index] && current[index].job.exitCode !== -1) {
        const result = await prompt({
          title: 'Pipeline Finished',
          text: [`Pipeline: ${current[index].job.title}`,
            'finished running sucesffully on the current dataset.  Click reload to load the annotations.  The current annotations will be replaced with the pipeline output.',
          ],
          confirm: true,
          positiveButton: 'Reload',
          negativeButton: 'Cancel',
        });
        if (result) {
          viewerRef.value.reloadAnnotations();
        }
      }
    });
    return {
      datasets,
      compoundId,
      viewerRef,
      buttonOptions,
      menuOptions,
      subTypeList,
      readonlyMode,
    };
  },
});
</script>

<template>
  <Viewer
    :id.sync="compoundId"
    ref="viewerRef"
    :readonly-mode="readonlyMode"
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
        :dataset-id="compoundId"
        v-bind="{ buttonOptions, menuOptions }"
        block-on-unsaved
      />
      <Export
        v-if="datasets[id]"
        :id="compoundId"
        :button-options="buttonOptions"
      />
    </template>
  </Viewer>
</template>
