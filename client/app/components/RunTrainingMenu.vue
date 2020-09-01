<script>
import { runTraining, getTrainingConfigurations } from 'app/api/viame.service';

export default {
  props: {
    selected: {
      type: Array,
      default: () => [],
    },
    small: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      trainingConfigurations: [],
      selectedTrainingConfig: null,
      defaultTrainingConfig: null,
      trainingOutputName: null,
      menuOpen: false,
    };
  },
  computed: {
    selectedEligibleClips() {
      return this.selected.filter(
        ({ _modelType, meta }) => _modelType === 'folder' && meta && meta.annotate,
      );
    },
    trainingDisabled() {
      return this.selectedEligibleClips.length !== 1;
    },
  },

  async created() {
    const resp = await getTrainingConfigurations();
    this.trainingConfigurations = resp.data.configs;
    this.defaultTrainingConfig = resp.data.default;
    this.selectedTrainingConfig = resp.data.default;
  },

  methods: {
    async runTrainingOnFolder() {
      const folder = this.selected[0];
      const config = this.selectedTrainingConfig;
      const pipelineName = this.trainingOutputName;

      await runTraining(folder, pipelineName, config);

      this.menuOpen = false;
      this.trainingOutputName = null;
      this.selectedTrainingConfig = this.defaultTrainingConfig;
      this.$snackbar({
        text: `Started training on folder ${folder.name}`,
        timeout: 2000,
        immediate: true,
      });
    },
  },
};
</script>

<template>
  <v-menu
    v-model="menuOpen"
    max-width="320"
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
        <v-card-title>
          Run Training
        </v-card-title>

        <v-card-text>
          Specify the name of the resulting pipeline
          and configuration file to use for training.
        </v-card-text>

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
          :items="trainingConfigurations"
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
