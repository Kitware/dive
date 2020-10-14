<script lang="ts">
import { defineComponent, computed, PropType } from '@vue/composition-api';
import { useApi } from 'viame-web-common/apispec';
import usePipelines from 'viame-web-common/use/usePipelines';

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
    const pipelines = usePipelines();
    const { runPipeline } = useApi();
    const pipelinesNotRunnable = computed(() => (
      props.selectedDatasetIds.length > 1 || pipelines.value === null
    ));

    async function runPipelineOnSelectedItem(pipename: string) {
      await Promise.all(
        props.selectedDatasetIds.map((id) => runPipeline(id, pipename)),
      );
      root.$snackbar({
        text: `Started pipeline on ${props.selectedDatasetIds.length} clip${
          props.selectedDatasetIds.length ? 's' : ''
        }`,
        timeout: 6000,
        immediate: true,
        button: 'View',
        callback: () => {
          root.$router.push({ name: 'jobs' });
        },
      });
    }

    function pipeTypeDisplay(pipeType: string) {
      switch (pipeType) {
        case 'generate':
          return 'utility';
        default:
          return `${pipeType}s`;
      }
    }

    return {
      pipelinesNotRunnable,
      pipeTypeDisplay,
      runPipelineOnSelectedItem,
    };
  },
});
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
