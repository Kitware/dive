<script lang="ts">
import {
  defineComponent,
  computed,
  PropType,
  ref,
  Ref,
  onBeforeMount,
} from 'vue';
import {
  Pipelines,
  Pipe,
  useApi,
  SubType,
  DatasetType,
} from 'dive-common/apispec';
import JobLaunchDialog from 'dive-common/components/JobLaunchDialog.vue';
import JobConfigFilterTranscodeDialog from 'dive-common/components/JobConfigFilterTranscodeDialog.vue';
import {
  stereoPipelineMarker,
  multiCamPipelineMarkers,
  LargeImageType,
  pipelineCreatesDatasetMarkers,
} from 'dive-common/constants';
import { useRequest } from 'dive-common/use';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

type MenuState = 'idle' | 'configuring';

export default defineComponent({
  name: 'RunPipelineMenu',

  components: {
    JobLaunchDialog,
    JobConfigFilterTranscodeDialog,
  },

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
    /* Disable pipelines for large-image type */
    typeList: {
      type: Array as PropType<DatasetType[]>,
      default: () => ([]),
    },
    /* Which pipelines to show based on dataset subtypes */
    subTypeList: {
      type: Array as PropType<SubType[]>,
      default: () => ([]),
    },
    /* Which pipelines to show based on how many cameras they accept */
    cameraNumbers: {
      type: Array as PropType<number[]>,
      default: () => ([1]),
    },
    runningPipelines: {
      type: Array as PropType<string[]>,
      default: () => ([]),
    },
    readOnlyMode: {
      type: Boolean,
      default: false,
    },
  },

  setup(props) {
    const { prompt } = usePrompt();
    const { runPipeline, getPipelineList } = useApi();
    const unsortedPipelines = ref({} as Pipelines);
    const selectedPipe = ref(null as Pipe | null);
    const camNumberStringArray = computed(() => props.cameraNumbers.map((v) => v.toString()));
    const {
      request: _runPipelineRequest,
      reset: dismissLaunchDialog,
      state: jobState,
    } = useRequest();

    const menuState: Ref<MenuState> = ref('idle');
    const configuring = computed(() => menuState.value === 'configuring');
    const selectedPipeline: Ref<Pipe | null> = ref(null);
    const selectedPipelineName = computed(() => (selectedPipeline.value ? selectedPipeline.value.name : ''));
    function cancelConfig() {
      menuState.value = 'idle';
    }

    const includesLargeImage = computed(() => props.typeList.includes(LargeImageType));

    const successMessage = computed(() => (
      `Started ${selectedPipe.value?.name} on ${props.selectedDatasetIds.length} dataset(s).`));

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
        // Filter out unsupported pipelines based on subTypeList
        // measurement can only be operated on stereo subtypes
        if (props.subTypeList.every((item) => item === 'stereo') && (name === stereoPipelineMarker)) {
          sortedPipelines[name] = category;
        } else if (props.subTypeList.every((item) => item === 'multicam') && (multiCamPipelineMarkers.includes(name))) {
          const pipelineExpectedCameraCount = name.split('-')[0];
          if (camNumberStringArray.value.includes(pipelineExpectedCameraCount)) {
            sortedPipelines[name] = category;
          }
        }
        if (name !== stereoPipelineMarker && !multiCamPipelineMarkers.includes(name)) {
          sortedPipelines[name] = category;
        }
      });
      return sortedPipelines;
    });

    const pipelinesNotRunnable = computed(() => (
      props.selectedDatasetIds.length < 1 || pipelines.value === null
    ));

    const pipelinesCurrentlyRunning = computed(
      () => props.selectedDatasetIds.reduce((acc, item) => acc || props.runningPipelines.includes(item), false),
    );

    const singlePipelineValue = computed(() => {
      if (props.selectedDatasetIds.length === 1) {
        return props.runningPipelines.includes(props.selectedDatasetIds[0]);
      }
      return false;
    });

    async function _runPipelineOnSelectedItemInner(
      pipeline: Pipe,
      additionalConfigById?: Record<string, Record<string, string> | undefined>,
    ) {
      if (props.selectedDatasetIds.length === 0) {
        throw new Error('No selected datasets to run on');
      }
      let datasetIds = props.selectedDatasetIds;
      if (props.cameraNumbers.length === 1 && props.cameraNumbers[0] > 1
      && (!multiCamPipelineMarkers.includes(pipeline.type)
      && stereoPipelineMarker !== pipeline.type)) {
        const cameraNames = props.selectedDatasetIds.map((item) => item.substring(0, item.lastIndexOf('/')));
        const result = await prompt({
          title: `Running Single Camera Pipeline on ${cameraNames[0]}`,
          text: ['Running a single pipeline on multi-camera data can produce conflicting track Ids',
            'Suggest Cancelling and deleting all existing tracks to ensure proper display of the output',
          ],
          confirm: true,
        });
        if (!result) {
          return;
        }
      }
      if (multiCamPipelineMarkers.includes(pipeline.type)
      || stereoPipelineMarker === pipeline.type) {
        datasetIds = props.selectedDatasetIds.map((item) => item.substring(0, item.lastIndexOf('/')));
      }
      selectedPipe.value = pipeline;
      await _runPipelineRequest(() => Promise.all(
        datasetIds.map((id) => {
          const additionalConfig = additionalConfigById ? additionalConfigById[id] : undefined;
          return runPipeline(id, pipeline, additionalConfig);
        }),
      ));
    }

    async function runPipelineOnSelectedItem(pipeline: Pipe) {
      if (!pipelineCreatesDatasetMarkers.includes(pipeline.type)) {
        _runPipelineOnSelectedItemInner(pipeline);
      } else {
        // If a pipeline creates datasets, open the configuration dialog
        // to allow users to name that dataset
        // This is relevant for filter and transcode pipeline types
        selectedPipeline.value = pipeline;
        menuState.value = 'configuring'; // force the dialog open
      }
    }

    /**
     * Handle a user confirming additional configuration for filter
     * or transcode pipelines, which create new datasets.
     *
     * @param outputNameMap Map selected dataset IDs to the name
     * of the resultant dataset created by the pipeline
     */
    async function exitPipelineConfig(outputNameMap: Record<string, string>) {
      menuState.value = 'idle'; // close the dialog
      const additionalConfigById: Record<string, Record<string, string>> = {};
      Object.keys(outputNameMap).forEach((id: string) => {
        additionalConfigById[id] = {
          outputDatasetName: outputNameMap[id],
        };
      });
      if (selectedPipeline.value) {
        _runPipelineOnSelectedItemInner(selectedPipeline.value, additionalConfigById);
      }
      selectedPipeline.value = null; // reset selected pipeline state
    }

    function pipeTypeDisplay(pipeType: string) {
      switch (pipeType) {
        case 'trained':
          return 'trained';
        case 'utility':
        case 'generate':
          return 'utilities';
        case 'transcode':
          return 'transcoders';
        default:
          return `${pipeType}s`;
      }
    }

    return {
      jobState,
      pipelines,
      pipelinesNotRunnable,
      includesLargeImage,
      successMessage,
      dismissLaunchDialog,
      pipeTypeDisplay,
      runPipelineOnSelectedItem,
      pipelinesCurrentlyRunning,
      singlePipelineValue,
      selectedPipeline,
      selectedPipelineName,
      configuring,
      cancelConfig,
      menuState,
      exitPipelineConfig,
    };
  },
});
</script>

<template>
  <div>
    <v-menu
      max-width="230"
      v-bind="menuOptions"
      :close-on-content-click="false"
    >
      <template #activator="{ on: menuOn }">
        <v-tooltip
          bottom
          :disabled="menuOptions.offsetX"
        >
          <template #activator="{ on: tooltipOn }">
            <v-btn
              v-bind="buttonOptions"
              :disabled="pipelinesNotRunnable || buttonOptions.disabled"
              :color="pipelinesCurrentlyRunning ? 'warning' : buttonOptions.color"
              v-on="{ ...tooltipOn, ...menuOn }"
            >
              <v-icon> mdi-pipe </v-icon>
              <span
                v-show="!$vuetify.breakpoint.mdAndDown || buttonOptions.block"
                class="pl-1"
              >
                Run pipeline
              </span>
              <v-spacer />
              <v-icon v-if="menuOptions.right">
                mdi-chevron-right
              </v-icon>
            </v-btn>
          </template>
          <span v-if="!pipelinesCurrentlyRunning">Run CV algorithm pipelines on this data</span>
          <span v-else>Pipeline is Currently running </span>
        </v-tooltip>
      </template>

      <template>
        <v-card v-if="pipelinesCurrentlyRunning">
          <v-card-title> Pipeline Running </v-card-title>
          <v-card-text>
            Data cannot be edited while a pipeline is queued.
            Pipelines produce output that will replace the existing annotations.
            You can check the status of your job or cancel it
          </v-card-text>
          <v-row class="pb-1">
            <!-- Viewer Loaded with single Job Running -->
            <v-btn
              v-if="singlePipelineValue && singlePipelineValue !== true"
              large
              depressed
              :href="singlePipelineValue"
              target="_blank"
              color="info"
              class="ma-auto"
            >
              View Running Job
            </v-btn>
            <!-- Desktop Job Running or Home/DataBrowser View -->
            <v-btn
              v-else
              large
              depressed
              to="/jobs"
              color="info"
              class="ma-auto"
            >
              View Running Job
            </v-btn>
          </v-row>
        </v-card>
        <v-card v-else-if="readOnlyMode">
          <v-card-title> Read only Mode</v-card-title>
          <v-card-text>
            This Dataset is in ReadOnly Mode.  You cannot run pipelines on this dataset.
          </v-card-text>
        </v-card>
        <v-card v-else-if="includesLargeImage">
          <v-card-title> Large Image</v-card-title>
          <v-card-text>
            Pipelines are not supported yet for Large Images.
          </v-card-text>
        </v-card>
        <v-card
          v-else-if="pipelines"
          outlined
        >
          <v-card-title> VIAME Pipelines </v-card-title>

          <v-card-text class="pb-0">
            Choose a pipeline type. Check the
            <a
              href="https://kitware.github.io/dive/Pipeline-Documentation/"
              target="_blank"
            >docs</a>
            for more information about these options.
          </v-card-text>
          <v-row class="px-3">
            <v-col
              v-for="pipeType in Object.keys(pipelines)"
              :key="pipeType"
              cols="12"
            >
              <v-menu
                :key="pipeType"
                offset-x
                right
              >
                <template #activator="{ on }">
                  <v-btn
                    depressed
                    block
                    v-on="on"
                  >
                    {{ pipeTypeDisplay(pipeType) }}
                    <v-icon
                      right
                      color="accent"
                      class="ml-2"
                    >
                      mdi-menu-right
                    </v-icon>
                  </v-btn>
                </template>

                <v-list
                  dense
                  outlined
                  style="overflow-y: auto; max-height: 85vh"
                >
                  <v-tooltip
                    v-for="pipeline in pipelines[pipeType].pipes"
                    :key="`${pipeline.name}-${pipeline.pipe}`"
                    left
                    :disabled="!pipeline.description"
                    max-width="300"
                    content-class="pipeline-description-tooltip"
                  >
                    <template #activator="{ on, attrs }">
                      <v-list-item
                        v-bind="attrs"
                        v-on="on"
                        @click="runPipelineOnSelectedItem(pipeline)"
                      >
                        <v-list-item-title class="font-weight-regular">
                          {{ pipeline.name }}
                        </v-list-item-title>
                      </v-list-item>
                    </template>
                    <span>{{ pipeline.description }}</span>
                  </v-tooltip>
                </v-list>
              </v-menu>
            </v-col>
          </v-row>
        </v-card>
      </template>
    </v-menu>
    <JobLaunchDialog
      :value="jobState.count > 0"
      :loading="jobState.loading"
      :error="jobState.error"
      :message="successMessage"
      @close="dismissLaunchDialog"
    />
    <JobConfigFilterTranscodeDialog
      :value="menuState === 'configuring'"
      :pipeline-name="selectedPipelineName"
      :selected-dataset-ids="selectedDatasetIds"
      @cancel="cancelConfig"
      @submit="exitPipelineConfig"
    />
  </div>
</template>

<style>
.pipeline-description-tooltip.v-tooltip__content {
  background: #3a3a3a !important;
  opacity: 1 !important;
}
</style>
