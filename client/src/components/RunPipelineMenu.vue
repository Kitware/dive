<script>
import { runPipeline } from '@/common/viame.service';
import { mapActions } from 'vuex';

export default {
  props: {
    selected: {
      type: Array,
      default: () => [],
    },
  },

  computed: {
    selectedEligibleClips() {
      return this.selected.filter(
        ({ _modelType, meta }) => _modelType === 'folder' && meta && meta.annotate,
      );
    },
    pipelinesNotRunnable() {
      return this.selectedEligibleClips.length < 1 || !this.pipelines;
    },
  },

  asyncComputed: {
    pipelines() {
      return this.fetchPipelines();
    },
  },

  created() {
    this.fetchPipelines();
  },

  methods: {
    ...mapActions(['fetchPipelines']),

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
          this.$router.push('/jobs');
        },
      });
    },
  },
};
</script>

<template>
  <v-menu
    max-width="300"
    offset-y
  >
    <template v-slot:activator="{ on }">
      <v-btn
        text
        small
        :disabled="pipelinesNotRunnable"
        v-on="on"
      >
        <v-icon
          left
          color="accent"
        >
          mdi-pipe
        </v-icon>
        Run pipeline
      </v-btn>
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

        <v-card-actions>
          <template
            v-for="(pipeType) in Object.keys(pipelines)"
          >
            <v-menu
              :key="pipeType"
              offset-y
            >
              <template v-slot:activator="{ on }">
                <v-btn
                  depressed
                  class="mx-2 grow"
                  v-on="on"
                >
                  {{ pipeType }}s
                  <v-icon
                    left
                    color="accent"
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
          </template>
        </v-card-actions>
      </v-card>
    </template>
  </v-menu>
</template>
