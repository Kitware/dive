<script>
import { runPipeline } from '@/common/viame.service';
import { mapState, mapActions } from 'vuex';

export default {
  props: {
    selected: {
      type: Array,
      default: () => [],
    },
  },

  computed: {
    ...mapState(['pipelines']),

    selectedEligibleClips() {
      return this.selected.filter(
        ({ _modelType, meta }) => _modelType === 'folder' && meta && meta.annotate,
      );
    },
    pipelinesRunnable() {
      return this.selectedEligibleClips.length < 1 || !this.pipelines.length;
    },
  },

  mounted() {
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
  <v-menu offset-y>
    <template v-slot:activator="{ on }">
      <v-btn
        text
        small
        :disabled="pipelinesRunnable"
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
    <v-list>
      <v-list-item
        v-for="pipeline in pipelines"
        :key="pipeline"
        @click="runPipelineOnSelectedItem(pipeline)"
      >
        <v-list-item-title>{{ pipeline }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>
