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
    const camNumbers = computed(() => [datasets.value[props.id]?.cameraNumber || 1]);
    const readonlyMode = computed(() => settings.value?.readonlyMode || false);
    const selectedCamera = ref('');

    watch(runningJobs, async (_previous, current) => {
      const currentJob = current.find((item) => item.job.datasetIds.includes(props.id));
      if (currentJob && currentJob.job.exitCode === 0 && currentJob.job.jobType === 'pipeline') {
        const result = await prompt({
          title: 'Pipeline Finished',
          text: [`Pipeline: ${currentJob.job.title}`,
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
    function changeCamera(cameraName: string) {
      selectedCamera.value = cameraName;
    }
    // When using multiCam some elements require a modified ID to be used
    const modifiedId = computed(() => {
      if (selectedCamera.value) {
        return `${props.id}/${selectedCamera.value}`;
      }
      return props.id;
    });
    return {
      datasets,
      compoundId,
      viewerRef,
      buttonOptions,
      menuOptions,
      subTypeList,
      camNumbers,
      readonlyMode,
      modifiedId,
      changeCamera,
    };
  },
});
</script>

<template>
  <Viewer
    :id.sync="compoundId"
    ref="viewerRef"
    :readonly-mode="readonlyMode"
    @change-camera="changeCamera"
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
        :selected-dataset-ids="[modifiedId]"
        :sub-type-list="subTypeList"
        :camera-numbers="camNumbers"
        v-bind="{ buttonOptions, menuOptions }"
      />
      <ImportAnnotations
        :dataset-id="modifiedId"
        v-bind="{ buttonOptions, menuOptions }"
        block-on-unsaved
      />
      <Export
        v-if="datasets[id]"
        :id="modifiedId"
        :button-options="buttonOptions"
      />
    </template>
  </Viewer>
</template>
