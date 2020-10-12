<script>
import { mapActions, mapState } from 'vuex';
import { runPipeline } from 'viame-web-common/api/viame.service';

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

  computed: {
    ...mapState('Pipelines', ['pipelines']),
    selectedEligibleClips() {
      return this.selected.filter(
        ({ _modelType, meta }) => _modelType === 'folder' && meta && meta.annotate,
      );
    },
    pipelinesNotRunnable() {
      return this.selectedEligibleClips.length < 1 || this.pipelines === null;
    },
  },

  created() {
    this.fetchPipelines();
  },

  methods: {
    ...mapActions('Pipelines', ['fetchPipelines']),

    async runPipelineOnSelectedItem(pipeline) {
      const clips = this.selectedEligibleClips;
      await Promise.all(
        this.selectedEligibleClips.map((item) => runPipeline(item._id, pipeline)),
      );
      this.$snackbar({
        text: `Started pipeline on ${clips.length} clip${
          clips.length ? 's' : ''
        }`,
        timeout: 6000,
        immediate: true,
        button: 'View',
        callback: () => {
          this.$router.push({ name: 'jobs' });
        },
      });
    },
    pipeTypeDisplay(pipeType) {
      switch (pipeType) {
        case 'generate':
          return 'utility';

        default:
          return `${pipeType}s`;
      }
    },
  },
};
</script>

<template>
  <v-menu
    max-width="320"
    offset-y
  >
    <template v-slot:activator="{ on: menuOn }">
      <v-tooltip bottom>
        <template #activator="{ on: tooltipOn }">
          <v-btn
            text
            :small="small"
            :disabled="pipelinesNotRunnable"
            v-on="{ ...tooltipOn, ...menuOn }"
          >
            <v-icon color="accent">
              mdi-pipe
            </v-icon>
            <span
              v-show="!$vuetify.breakpoint.mdAndDown"
              class="pl-1"
            >
              Run pipeline
            </span>
          </v-btn>
        </template>
        <span>Run CV algorithm pipelines on this data</span>
      </v-tooltip>
    </template>

    <template>
      <v-card v-if="pipelines">
        <v-card-title>
          VIAME Pipelines
        </v-card-title>

        <v-card-text class="pb-0">
          Choose a pipeline type. Check the
          <a
            href="https://github.com/VIAME/VIAME-Web/wiki/Pipeline-Documentation"
            target="_blank"
          >docs</a>
          for more information about these options.
        </v-card-text>
        <v-row class="px-3">
          <v-col
            v-for="(pipeType) in Object.keys(pipelines)"
            :key="pipeType"
            cols="6"
          >
            <v-menu
              :key="pipeType"
              offset-y
            >
              <template v-slot:activator="{ on }">
                <v-btn
                  depressed
                  block
                  v-on="on"
                >
                  {{ pipeTypeDisplay(pipeType) }}
                  <v-icon
                    left
                    color="accent"
                    class="ml-0"
                  >
                    mdi-menu-down
                  </v-icon>
                </v-btn>
              </template>

              <v-list>
                <v-list-item
                  v-for="({ name, pipe }) in pipelines[pipeType].pipes"
                  :key="pipe"
                  @click="runPipelineOnSelectedItem(pipe)"
                >
                  <v-list-item-title>
                    {{ name }}
                  </v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
          </v-col>
        </v-row>
      </v-card>
    </template>
  </v-menu>
</template>
