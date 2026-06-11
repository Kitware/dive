<script lang="ts">
import {
  defineComponent,
  computed,
  PropType,
  ref,
  Ref,
  onBeforeMount,
} from 'vue';
import { mergeActivatorProps, menuOpensToSide } from 'dive-common/vue-utilities/mergeActivatorProps';
import {
  Pipelines,
  Pipe,
  useApi,
  SubType,
  DatasetType,
} from 'dive-common/apispec';
import JobLaunchDialog from 'dive-common/components/JobLaunchDialog.vue';
import JobConfigFilterTranscodeDialog from 'dive-common/components/JobConfigFilterTranscodeDialog.vue';
import RunPipelineToast from 'dive-common/components/RunPipelineToast.vue';
import {
  stereoPipelineMarker,
  multiCamPipelineMarkers,
  LargeImageType,
  pipelineCreatesDatasetMarkers,
} from 'dive-common/constants';
import { parentDatasetId } from 'dive-common/compositeDatasetId';
import { filterPipelinesForDatasets } from 'dive-common/pipelineMenuFilters';
import pipelineTypeDisplay from 'dive-common/pipelineTypeDisplay';
import { useRequest } from 'dive-common/use';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import PipelineParamsDialog from 'dive-common/components/PipelineParamsDialog.vue';

type MenuState = 'idle' | 'configuring';

export default defineComponent({
  name: 'RunPipelineMenu',

  components: {
    JobLaunchDialog,
    JobConfigFilterTranscodeDialog,
    PipelineParamsDialog,
    RunPipelineToast,
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
    /* Time filter range from the viewer - [startFrame, endFrame] or null */
    timeFilter: {
      type: Array as unknown as PropType<[number, number] | null>,
      default: null,
    },
    /** Case-insensitive substrings; matching categories/pipes are omitted from the menu. */
    excludePipelineTerms: {
      type: Array as PropType<string[]>,
      default: () => ([]),
    },
  },

  setup(props) {
    const { prompt } = usePrompt();
    const { runPipeline, getPipelineList } = useApi();
    const unsortedPipelines = ref({} as Pipelines);
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
    const showParamsDialog = ref(false);
    const pipelineParams = ref<Record<string, string>>({});

    function openDiveParamsDialog(pipeline: Pipe) {
      selectedPipeline.value = pipeline;
      const defaults: Record<string, string> = {};
      pipeline?.metadata?.diveParams?.forEach((param) => {
        defaults[param.key] = param.default;
      });
      pipelineParams.value = defaults;
      showParamsDialog.value = true;
    }

    async function confirmPipelineExecution(updatedParams: Record<string, string>) {
      const configById: Record<string, Record<string, string>> = {};
      props.selectedDatasetIds.forEach((id) => {
        configById[id] = updatedParams;
      });
      showParamsDialog.value = false;
      await _runPipelineOnSelectedItemInner(selectedPipeline.value!, configById);
    }

    const includesLargeImage = computed(() => props.typeList.includes(LargeImageType));

    const successMessage = computed(() => (
      `Started ${selectedPipeline.value?.name} on ${props.selectedDatasetIds.length} dataset(s).`));

    onBeforeMount(async () => {
      try {
        unsortedPipelines.value = await getPipelineList();
      } catch (err) {
        console.error('RunPipelineMenu: failed to load pipelines', err);
      }
    });

    const pipelines = computed(() => filterPipelinesForDatasets(
      unsortedPipelines.value,
      props.subTypeList,
      props.cameraNumbers,
      props.typeList,
      props.excludePipelineTerms,
    ));

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
        const cameraNames = props.selectedDatasetIds.map((item) => parentDatasetId(item));
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
        datasetIds = props.selectedDatasetIds.map((item) => parentDatasetId(item));
      }
      selectedPipeline.value = pipeline;
      const frameRange = props.timeFilter;
      await _runPipelineRequest(() => Promise.all(
        datasetIds.map((id) => {
          const additionalConfig = additionalConfigById ? additionalConfigById[id] : undefined;
          return runPipeline(id, pipeline, {
            kwiverParams: additionalConfig,
            runtimeParams: frameRange ? { frameRange } : undefined,
          });
        }),
      ));
    }

    async function runPipelineOnSelectedItem(pipeline: Pipe) {
      if (pipeline.metadata?.diveParams && pipeline.metadata?.diveParams?.length > 0) {
        openDiveParamsDialog(pipeline);
        return;
      }
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

    return {
      jobState,
      pipelines,
      pipelinesNotRunnable,
      includesLargeImage,
      successMessage,
      dismissLaunchDialog,
      pipeTypeDisplay: pipelineTypeDisplay,
      runPipelineOnSelectedItem,
      pipelinesCurrentlyRunning,
      singlePipelineValue,
      selectedPipeline,
      selectedPipelineName,
      configuring,
      cancelConfig,
      menuState,
      exitPipelineConfig,
      pipelineParams,
      showParamsDialog,
      confirmPipelineExecution,
      mergeActivatorProps,
      menuOpensToSide,
    };
  },
});
</script>

<template>
  <div>
    <v-tooltip
      location="bottom"
      :disabled="menuOpensToSide(menuOptions)"
    >
      <template #activator="{ props: tooltipProps }">
        <span
          v-bind="tooltipProps"
          class="d-inline-flex"
        >
          <v-menu
            max-width="230"
            max-height="none"
            content-class="pipeline-menu-content"
            v-bind="menuOptions"
            :close-on-content-click="false"
          >
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="mergeActivatorProps(menuProps, buttonOptions)"
                :disabled="pipelinesNotRunnable || buttonOptions.disabled"
                :color="pipelinesCurrentlyRunning ? 'warning' : buttonOptions.color"
              >
                <v-icon> mdi-pipe </v-icon>
                <span
                  v-show="!$vuetify.display.mdAndDown || buttonOptions.block"
                  class="pl-1"
                >
                  Run pipeline
                </span>
                <v-spacer />
                <v-icon v-if="menuOpensToSide(menuOptions)">
                  mdi-chevron-right
                </v-icon>
              </v-btn>
            </template>

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
            <v-row class="px-3 pipeline-categories-row">
              <v-col
                v-for="(pipeType, categoryIndex) in Object.keys(pipelines)"
                :key="pipeType"
                cols="12"
                :class="{ 'pipeline-category-col--last': categoryIndex === Object.keys(pipelines).length - 1 }"
              >
                <v-menu
                  :key="pipeType"
                  location="end"
                  max-height="none"
                  content-class="pipeline-menu-content"
                >
                  <template #activator="{ props: activatorProps }">
                    <v-btn
                      variant="flat"
                      block
                      v-bind="activatorProps"
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
                    density="compact"
                    class="pipeline-submenu-list"
                  >
                    <v-tooltip
                      v-for="pipeline in pipelines[pipeType].pipes"
                      :key="`${pipeline.name}-${pipeline.pipe}`"
                      location="start"
                      :open-delay="250"
                      :disabled="!pipeline?.metadata?.description"
                      max-width="400"
                      content-class="pipeline-description-tooltip"
                    >
                      <template #activator="{ props: activatorProps }">
                        <v-list-item
                          v-bind="activatorProps"
                          @click="runPipelineOnSelectedItem(pipeline)"
                        >
                          <v-list-item-title class="font-weight-regular" style="display: flex; justify-content: space-between; align-items: center;">
                            {{ pipeline.name }}
                            <v-icon style="margin-left: 20px">
                              {{ pipeline.metadata?.diveParams?.length ?? 0 > 0 ? 'mdi-application-cog-outline' : 'mdi-play-outline' }}
                            </v-icon>
                          </v-list-item-title>
                        </v-list-item>
                      </template>
                      <RunPipelineToast :pipeline="pipeline" />
                    </v-tooltip>
                  </v-list>
                </v-menu>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
          </v-menu>
        </span>
      </template>
      <span v-if="!pipelinesCurrentlyRunning">Run CV algorithm pipelines on this data</span>
      <span v-else>Pipeline is Currently running </span>
    </v-tooltip>
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
    <PipelineParamsDialog
      v-model="showParamsDialog"
      :pipeline="selectedPipeline"
      :params="pipelineParams"
      @confirm="confirmPipelineExecution"
    />
  </div>
</template>

<style>
/* Vuetify sets overflow-y: auto on .v-menu__content; scroll only on the list */
.pipeline-menu-content.v-menu__content {
  overflow-y: visible;
  overflow-x: visible;
  contain: none;
  max-height: none !important;
}

.pipeline-submenu-list {
  max-height: 60vh;
  overflow-y: auto;
}

.pipeline-category-col--last {
  padding-bottom: 12px;
  margin-bottom: 12px;
}

.pipeline-description-tooltip.v-tooltip__content {
  background: #3a3a3a !important;
  opacity: 1 !important;
}
</style>
