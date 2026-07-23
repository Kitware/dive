<script lang="ts">
import {
  computed,
  defineComponent,
  PropType,
  ref,
  Ref,
  onBeforeMount,
  watch,
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
import RunPipelineToast from 'dive-common/components/RunPipelineToast.vue';
import {
  stereoPipelineMarker,
  multiCamPipelineMarkers,
  LargeImageType,
} from 'dive-common/constants';
import { parentDatasetId } from 'dive-common/compositeDatasetId';
import { filterPipelinesForDatasets } from 'dive-common/pipelineMenuFilters';
import {
  pipelineDisabledForMissingCalibration,
} from 'dive-common/pipelineCalibration';
import { pipelineCreatesNewDataset } from 'dive-common/pipelineCreatesDataset';
import { pipelineHasParams, pipelineRequiresParams } from 'dive-common/pipelineParams';
import pipelineTypeDisplay from 'dive-common/pipelineTypeDisplay';
import { useRequest } from 'dive-common/use';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import PipelineParamsDialog from 'dive-common/components/PipelineParamsDialog.vue';
import PipelineCalibrationWarningIcon from 'dive-common/components/PipelineCalibrationWarningIcon.vue';

type MenuState = 'idle' | 'configuring';

export default defineComponent({
  name: 'RunPipelineMenu',

  components: {
    JobLaunchDialog,
    JobConfigFilterTranscodeDialog,
    PipelineParamsDialog,
    RunPipelineToast,
    PipelineCalibrationWarningIcon,
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
    const { runPipeline, getPipelineList, hasCalibrationFile } = useApi();
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
      unsortedPipelines.value = await getPipelineList();
    });

    const calibrationAvailableByDatasetId = ref<Record<string, boolean>>({});

    async function refreshCalibrationStatus() {
      if (!hasCalibrationFile || props.selectedDatasetIds.length === 0) {
        calibrationAvailableByDatasetId.value = {};
        return;
      }
      const parentIds = [...new Set(props.selectedDatasetIds.map((id) => parentDatasetId(id)))];
      const entries = await Promise.all(
        parentIds.map(async (datasetId) => {
          const available = await hasCalibrationFile(datasetId);
          return [datasetId, available] as const;
        }),
      );
      calibrationAvailableByDatasetId.value = Object.fromEntries(entries);
    }

    watch(() => props.selectedDatasetIds, () => {
      refreshCalibrationStatus();
    }, { immediate: true });

    function isPipelineDisabledForCalibration(pipeline: Pipe) {
      return pipelineDisabledForMissingCalibration(
        pipeline,
        calibrationAvailableByDatasetId.value,
        props.selectedDatasetIds.map((id) => parentDatasetId(id)),
      );
    }

    function pipelineTooltipDisabled(pipeline: Pipe) {
      return !pipeline?.metadata?.description;
    }

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
      outputDatasetNameById?: Record<string, string>,
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
        datasetIds.map((id) => runPipeline(id, pipeline, {
          runtimeParams: frameRange ? { frameRange } : undefined,
          outputDatasetName: outputDatasetNameById?.[id],
        })),
      ));
    }

    async function runPipelineOnSelectedItem(pipeline: Pipe) {
      if (isPipelineDisabledForCalibration(pipeline)) {
        return;
      }
      // Only required params block the run; optional ones already hold the
      // .pipe file's own values, and stay reachable from the gear.
      if (pipelineRequiresParams(pipeline)) {
        openDiveParamsDialog(pipeline);
        return;
      }
      if (!pipelineCreatesNewDataset(pipeline)) {
        _runPipelineOnSelectedItemInner(pipeline);
      } else {
        // If a pipeline creates datasets, open the configuration dialog
        // to allow users to name that dataset
        // This is relevant for filter and transcode pipeline types
        // (including multicam filter_*_N-cam pipes categorized as 2-cam/3-cam)
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
      if (selectedPipeline.value) {
        let nameByDatasetId = outputNameMap;
        // Multicam/stereo pipes run against the parent dataset id; remap names
        // keyed by camera composite ids so the chosen name is applied.
        if (multiCamPipelineMarkers.includes(selectedPipeline.value.type)
          || stereoPipelineMarker === selectedPipeline.value.type) {
          nameByDatasetId = {};
          Object.entries(outputNameMap).forEach(([id, name]) => {
            nameByDatasetId[parentDatasetId(id)] = name;
          });
        }
        _runPipelineOnSelectedItemInner(selectedPipeline.value, nameByDatasetId);
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
      isPipelineDisabledForCalibration,
      pipelineTooltipDisabled,
      openDiveParamsDialog,
      pipelineHasParams,
    };
  },
});
</script>

<template>
  <div>
    <v-menu
      max-width="230"
      max-height="none"
      content-class="pipeline-menu-content"
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
            <v-row class="px-3 pipeline-categories-row">
              <v-col
                v-for="(pipeType, categoryIndex) in Object.keys(pipelines)"
                :key="pipeType"
                cols="12"
                :class="{ 'pipeline-category-col--last': categoryIndex === Object.keys(pipelines).length - 1 }"
              >
                <v-menu
                  :key="pipeType"
                  offset-x
                  right
                  max-height="none"
                  content-class="pipeline-menu-content"
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
                    class="pipeline-submenu-list"
                  >
                    <v-tooltip
                      v-for="pipeline in pipelines[pipeType].pipes"
                      :key="`${pipeline.name}-${pipeline.pipe}`"
                      left
                      :open-delay="250"
                      :disabled="pipelineTooltipDisabled(pipeline)"
                      max-width="400"
                      content-class="pipeline-description-tooltip"
                    >
                      <template #activator="{ on, attrs }">
                        <v-list-item
                          v-bind="attrs"
                          :class="{ 'pipeline-item--unavailable': isPipelineDisabledForCalibration(pipeline) }"
                          v-on="on"
                          @click="runPipelineOnSelectedItem(pipeline)"
                        >
                          <v-list-item-title class="font-weight-regular" style="display: flex; justify-content: space-between; align-items: center;">
                            {{ pipeline.name }}
                            <span style="display: flex; align-items: center; gap: 8px; margin-left: 20px;">
                              <PipelineCalibrationWarningIcon
                                v-if="isPipelineDisabledForCalibration(pipeline)"
                              />
                              <!-- The gear is its own hit target: clicking it
                                configures, clicking anywhere else on the entry
                                runs with the pipeline's own defaults. -->
                              <v-btn
                                v-if="pipelineHasParams(pipeline)"
                                icon
                                small
                                class="pipeline-params-button"
                                :aria-label="`Configure ${pipeline.name}`"
                                @click.stop="openDiveParamsDialog(pipeline)"
                              >
                                <v-icon>mdi-cog-outline</v-icon>
                              </v-btn>
                            </span>
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

/* Keep the gear's hit area comfortably clear of the pipeline name, so a click
   meant for the name does not land on the button. */
.pipeline-params-button {
  margin-left: 20px;
}

.pipeline-category-col--last {
  padding-bottom: 12px;
  margin-bottom: 12px;
}

.pipeline-description-tooltip.v-tooltip__content {
  background: #3a3a3a !important;
  opacity: 1 !important;
}

.pipeline-item--unavailable {
  opacity: 0.55;
  cursor: not-allowed;
  background: rgba(251, 140, 0, 0.08);
}
</style>
