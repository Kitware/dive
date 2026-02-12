<script lang="ts">
import {
  defineComponent,
  watch,
  ref,
  Ref,
  PropType,
} from 'vue';

export default defineComponent({
  props: {
    value: {
      type: Boolean,
      default: false,
    },
    pipelineName: {
      type: String,
      required: true,
    },
    // Since this feature is currently only available in Desktop, and Desktop
    // runs a pipeline on a single dataset at a time, this array should always be length 1.
    selectedDatasetIds: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },
  emits: ['cancel', 'submit'],
  setup(props, { emit }) {
    const formValid = ref(false);
    const dialogOpenTimestamp = ref('');
    const outputDatasetNames: Ref<Record<string, string>> = ref({});

    watch(() => props.value, () => {
      dialogOpenTimestamp.value = (new Date()).toISOString().replace(/[:.]/g, '-');
      props.selectedDatasetIds.forEach((id: string) => {
        outputDatasetNames.value[id] = `${props.pipelineName}_${id}_${dialogOpenTimestamp.value}`;
      });
    });

    function cancelPipeline() {
      emit('cancel');
    }

    function submitPipelines() {
      emit('submit', outputDatasetNames.value);
    }

    return {
      formValid,
      outputDatasetNames,
      cancelPipeline,
      submitPipelines,
    };
  },
});
</script>

<template>
  <v-dialog
    v-model="value"
    width="67%"
  >
    <v-card outlined>
      <v-card-title>
        Job Configuration
      </v-card-title>
      <v-card-text class="d-flex flex-column justify-center">
        You have selected a pipeline that will create a new dataset. Please choose a
        name for that dataset.
        <v-form
          v-model="formValid"
          class="mt-2"
        >
          <v-col>
            <v-row
              v-for="datasetId in selectedDatasetIds"
              :key="datasetId"
              class="d-flex justify-center align-end"
            >
              <v-col>
                <v-label>
                  {{ datasetId }}
                </v-label>
              </v-col>
              <v-col>
                <v-text-field
                  v-model="outputDatasetNames[datasetId]"
                  class="ml-2"
                  label="Output dataset name"
                  :rules="[v => !!v || 'Each output dataset must have a name']"
                  hide-details
                />
              </v-col>
            </v-row>
          </v-col>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          color="error"
          @click="cancelPipeline"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!formValid"
          @click="submitPipelines"
        >
          Submit
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
