<script lang="ts">
import {
  defineComponent, computed, PropType, ref, onBeforeMount, watch, toRef,
} from '@vue/composition-api';

import { useApi, TrainingConfigs } from 'dive-common/apispec';
import JobLaunchDialog from 'dive-common/components/JobLaunchDialog.vue';
import ImportButton from 'dive-common/components/ImportButton.vue';
import { useRequest } from 'dive-common/use';
import { simplifyTrainingName } from 'dive-common/constants';


export default defineComponent({
  name: 'RunTrainingMenu',

  components: { JobLaunchDialog, ImportButton },

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

  setup(props, { root }) {
    const brandData = toRef(root.$store.state.Brand, 'brandData');
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
    const labelText = ref<string>('');
    const labelFile = ref<File>();

    async function runTrainingOnFolder() {
      const outputPipelineName = trainingOutputName.value;
      if (trainingDisabled.value || !outputPipelineName) {
        return;
      }
      await _runTrainingRequest(() => {
        if (!trainingConfigurations.value || !selectedTrainingConfig.value) {
          throw new Error('Training configurations not found.');
        }
        if (labelText) {
          return runTraining(
            props.selectedDatasetIds,
            outputPipelineName,
            selectedTrainingConfig.value,
            annotatedFramesOnly.value,
            labelText.value,
          );
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

    watch(labelFile, () => {
      if (labelFile.value) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          labelText.value = evt.target?.result as string;
        };
        reader.readAsText(labelFile.value);
      }
    });

    const clearLabelText = () => {
      labelText.value = '';
    };

    return {
      brandData,
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
      labelFile,
      clearLabelText,
      simplifyTrainingName,
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
              Check the
              <a href="https://kitware.github.io/dive/Pipeline-Documentation/#training">
                documentation
              </a>
              for more information about these options.
            </p>
            <v-alert
              v-if="brandData.trainingMessage"
              dense
              color="warning"
              outlined
            >
              {{ brandData.trainingMessage }}
            </v-alert>

            <v-text-field
              v-model="trainingOutputName"
              outlined
              class="my-4"
              label="New Model Name"
              hint="Choose a name for the newly trained model"
              persistent-hint
            />
            <v-select
              v-model="selectedTrainingConfig"
              outlined
              class="my-4"
              label="Configuration File"
              :items="trainingConfigurations.configs"
              :hint="selectedTrainingConfig"
              persistent-hint
            >
              <template v-slot:item="row">
                {{ simplifyTrainingName(row.item) }}
              </template>
              <template v-slot:selection="{ item}">
                {{ simplifyTrainingName(item) }}
              </template>
            </v-select>
            <v-file-input
              v-model="labelFile"
              icon="mdi-folder-open"
              label="Labels.txt mapping file (optional)"
              hint="Combine or rename output classes using a labels.txt file"
              persistent-hint
              clearable
              @click:clear="clearLabelText"
            />
            <v-checkbox
              v-model="annotatedFramesOnly"
              label="Use annotated frames only"
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
