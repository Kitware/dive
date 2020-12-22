<script lang="ts">
import {
  defineComponent, computed, PropType, ref, onBeforeMount,
} from '@vue/composition-api';

import { useApi, TrainingConfigs } from 'viame-web-common/apispec';


export default defineComponent({
  props: {
    selectedDatasetIds: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    small: {
      type: Boolean,
      default: false,
    },
  },

  setup(props, { root }) {
    const { getTrainingConfigurations, runTraining } = useApi();

    const trainingConfigurations = ref<TrainingConfigs | null>(null);
    const selectedTrainingConfig = ref<string | null>(null);

    onBeforeMount(async () => {
      const resp = await getTrainingConfigurations();

      trainingConfigurations.value = resp;
      selectedTrainingConfig.value = resp.default;
    });

    const trainingDisabled = computed(() => props.selectedDatasetIds.length === 0);
    const trainingOutputName = ref<string | null>(null);
    const menuOpen = ref(false);

    async function runTrainingOnFolder() {
      if (!trainingConfigurations.value || !selectedTrainingConfig.value) {
        throw new Error('Training Configurations not found.');
      }

      if (trainingDisabled.value || !trainingOutputName.value) {
        return;
      }

      try {
        await runTraining(
          props.selectedDatasetIds,
          trainingOutputName.value,
          selectedTrainingConfig.value,
        );

        menuOpen.value = false;
        trainingOutputName.value = null;
        selectedTrainingConfig.value = trainingConfigurations.value.default;

        root.$snackbar({
          text: 'Training started',
          timeout: 2000,
          immediate: true,
          button: 'View',
        });
      } catch (err) {
        let text = 'Unable to run training';
        if (err.response && err.response.status === 403) {
          text = 'You do not have permission to run training on the selected resource(s).';
        }

        root.$prompt({
          title: 'Training Failed',
          text,
          positiveButton: 'OK',
        });
      }
    }

    return {
      trainingConfigurations,
      selectedTrainingConfig,
      trainingOutputName,
      menuOpen,
      trainingDisabled,
      runTrainingOnFolder,
    };
  },
});
</script>

<template>
  <v-menu
    v-model="menuOpen"
    max-width="500"
    offset-y
    :close-on-content-click="false"
  >
    <template v-slot:activator="{ on: menuOn }">
      <v-tooltip bottom>
        <template #activator="{ on: tooltipOn }">
          <v-btn
            text
            :small="small"
            :disabled="trainingDisabled"
            v-on="{ ...tooltipOn, ...menuOn }"
          >
            <v-icon color="accent">
              mdi-brain
            </v-icon>
            <span
              v-show="!$vuetify.breakpoint.mdAndDown"
              class="pl-1"
            >
              Run Training
            </span>
          </v-btn>
        </template>
        <span>Train a detector model on this data</span>
      </v-tooltip>
    </template>

    <template>
      <v-card v-if="trainingConfigurations">
        <v-card-title class="pb-1">
          Run Training
        </v-card-title>

        <v-card-text>
          Specify the name of the resulting pipeline
          and configuration file to use for training.
        </v-card-text>

        <v-alert
          dense
          type="warning"
        >
          This instance is updated on Thursday at 2AM EST.
          If your training job is running at that time it may be restarted/killed.
        </v-alert>

        <v-text-field
          v-model="trainingOutputName"
          class="mx-2"
          outlined
          label="Output Name"
        />
        <v-select
          v-model="selectedTrainingConfig"
          outlined
          class="mx-2"
          label="Configuration File"
          :items="trainingConfigurations.configs"
        />
        <v-btn
          depressed
          class="mb-2 ml-2"
          color="primary"
          :disabled="!trainingOutputName || !selectedTrainingConfig"
          @click="runTrainingOnFolder"
        >
          Run Training
        </v-btn>
      </v-card>
    </template>
  </v-menu>
</template>
