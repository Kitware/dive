<script lang="ts">
import {
  defineComponent, computed, PropType, ref, onBeforeMount,
} from '@vue/composition-api';

import { useApi, TrainingConfigs } from 'dive-common/apispec';
import JobLaunchDialog from 'dive-common/components/JobLaunchDialog.vue';
import { useRequest } from 'dive-common/use';

export default defineComponent({
  name: 'RunTrainingMenu',

  components: { JobLaunchDialog },

  props: {
    selectedDatasetIds: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    buttonOptions: {
      type: Object,
      default: () => ({}),
    },
    menuOptions: {
      type: Object,
      default: () => ({}),
    },
  },

  setup(props) {
    const { getTrainingConfigurations, runTraining } = useApi();

    const trainingConfigurations = ref<TrainingConfigs | null>(null);
    const selectedTrainingConfig = ref<string | null>(null);
    const annotatedFramesOnly = ref<boolean>(false);
    const {
      request: _runTrainingRequest,
      reset: dismissJobDialog,
      state: jobState,
    } = useRequest();

    const successMessage = computed(() => `Started training on ${props.selectedDatasetIds.length} dataset(s)`);

    onBeforeMount(async () => {
      const resp = await getTrainingConfigurations();
      trainingConfigurations.value = resp;
      selectedTrainingConfig.value = resp.default;
    });

    const trainingDisabled = computed(() => props.selectedDatasetIds.length === 0);
    const trainingOutputName = ref<string | null>(null);
    const menuOpen = ref(false);

    async function runTrainingOnFolder() {
      const outputPipelineName = trainingOutputName.value;
      if (trainingDisabled.value || !outputPipelineName) {
        return;
      }
      await _runTrainingRequest(() => {
        if (!trainingConfigurations.value || !selectedTrainingConfig.value) {
          throw new Error('Training configurations not found.');
        }
        return runTraining(
          props.selectedDatasetIds,
          outputPipelineName,
          selectedTrainingConfig.value,
          annotatedFramesOnly.value,
        );
      });
      menuOpen.value = false;
      trainingOutputName.value = null;
    }

    return {
      trainingConfigurations,
      selectedTrainingConfig,
      annotatedFramesOnly,
      trainingOutputName,
      menuOpen,
      trainingDisabled,
      jobState,
      successMessage,
      dismissJobDialog,
      runTrainingOnFolder,
    };
  },
});
</script>

<template>
  <div>
    <v-menu
      v-model="menuOpen"
      max-width="500"
      v-bind="menuOptions"
      :close-on-content-click="false"
    >
      <template v-slot:activator="{ on: menuOn }">
        <v-tooltip
          bottom
          :disabled="menuOptions.offsetX"
        >
          <template #activator="{ on: tooltipOn }">
            <v-btn
              v-bind="buttonOptions"
              :disabled="trainingDisabled"
              v-on="{ ...tooltipOn, ...menuOn }"
            >
              <v-icon>
                mdi-brain
              </v-icon>
              <span
                v-show="!$vuetify.breakpoint.mdAndDown || buttonOptions.block"
                class="pl-1"
              >
                Run Training
              </span>
              <v-spacer />
              <v-icon>mdi-chevron-right</v-icon>
            </v-btn>
          </template>
          <span>Train a detector model on this data</span>
        </v-tooltip>
      </template>

      <template>
        <v-card
          v-if="trainingConfigurations"
          outlined
        >
          <v-card-title class="pb-1">
            Run Training
          </v-card-title>

          <v-card-text>
            <p>
              Specify the name of the resulting pipeline
              and configuration file to use for training.
            </p>
            <v-alert
              dense
              color="warning"
              outlined
            >
              This server is updated on Thursday at 2AM EST.
              If your training job is running at that time it may be restarted or killed.
            </v-alert>

            <v-text-field
              v-model="trainingOutputName"
              outlined
              hide-details
              class="my-4"
              label="Output Name"
            />
            <v-select
              v-model="selectedTrainingConfig"
              outlined
              hide-details
              class="my-4"
              label="Configuration File"
              :items="trainingConfigurations.configs"
            />
            <v-checkbox
              v-model="annotatedFramesOnly"
              label="Use annotated frames only"
              dense
              hint="Train only on frames with groundtruth and ignore frames without annotations"
              persistent-hint
              class="pt-0"
            />
            <v-btn
              depressed
              block
              color="primary"
              class="mt-4"
              :disabled="!trainingOutputName || !selectedTrainingConfig"
              @click="runTrainingOnFolder"
            >
              Train on {{ selectedDatasetIds.length }} dataset(s)
            </v-btn>
          </v-card-text>
        </v-card>
      </template>
    </v-menu>
    <JobLaunchDialog
      :value="jobState.count > 0"
      :loading="jobState.loading"
      :error="jobState.error"
      :message="successMessage"
      @close="dismissJobDialog"
    />
  </div>
</template>
