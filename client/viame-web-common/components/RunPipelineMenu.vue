<script lang="ts">
import {
  defineComponent, computed, PropType, ref, onBeforeMount,
} from '@vue/composition-api';
import { Pipelines, useApi } from 'viame-web-common/apispec';

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
    const { runPipeline, getPipelineList } = useApi();
    const unsortedPipelines = ref({} as Pipelines);
    onBeforeMount(async () => {
      unsortedPipelines.value = await getPipelineList();
    });

    const pipelines = computed(() => {
      const sortedPipelines = {} as Pipelines;
      Object.entries(unsortedPipelines.value).forEach(([name, category]) => {
        category.pipes.sort((a, b) => {
          const aName = a.name.toLowerCase();
          const bName = b.name.toLowerCase();
          if (aName > bName) {
            return 1;
          }
          if (aName < bName) {
            return -1;
          }
          return 0;
        });
        sortedPipelines[name] = category;
      });
      return sortedPipelines;
    });

    const pipelinesNotRunnable = computed(() => (
      props.selectedDatasetIds.length < 1 || pipelines.value === null
    ));

    async function runPipelineOnSelectedItem(pipename: string) {
      if (props.selectedDatasetIds.length === 0) {
        throw new Error('No selected datasets to run on');
      }
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
        case 'trained':
          return 'trained';
        case 'generate':
          return 'utility';
        default:
          return `${pipeType}s`;
      }
    }

    return {
      pipelines,
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
