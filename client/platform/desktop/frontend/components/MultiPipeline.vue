<script setup lang="ts">
import {
  computed,
  onBeforeMount,
  ref,
  Ref,
  watch,
} from 'vue';
import { DataTableHeader } from 'vuetify';
import { useRoute, useRouter } from 'vue-router/composables';
import { Pipe, Pipelines, useApi } from 'dive-common/apispec';
import { parentDatasetId } from 'dive-common/compositeDatasetId';
import {
  stereoPipelineMarker,
  multiCamPipelineMarkers,
  MultiType,
} from 'dive-common/constants';
import { pipelineCreatesNewDataset } from 'dive-common/pipelineCreatesDataset';
import pipelineTypeDisplay from 'dive-common/pipelineTypeDisplay';
import {
  pipelineDisabledForMissingCalibration,
  pipelineRequiresCalibration,
} from 'dive-common/pipelineCalibration';
import PipelineCalibrationWarningIcon from 'dive-common/components/PipelineCalibrationWarningIcon.vue';
import DatasetPicker from 'dive-common/components/DatasetPicker.vue';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { clientSettings } from 'dive-common/store/settings';
import { datasets, JsonConfigCache } from '../store/dataset';

const { getPipelineList, runPipeline, hasCalibrationFile } = useApi();
const { prompt } = usePrompt();
const router = useRouter();
const route = useRoute();

/** Dataset ids handed off by another page (e.g. the Library selection). */
function preselectedDatasetIds(): string[] {
  const query = route.query.datasetIds;
  const values = Array.isArray(query) ? query : [query];
  return values
    .flatMap((value) => (value || '').split(','))
    .filter((id) => id in datasets.value);
}

const unsortedPipelines = ref({} as Pipelines);
const selectedPipelineType: Ref<string | null> = ref(null);
const pipelineTypes = computed(() => (
  // For now, exclude 2-cam and 3-cam pipeline types from
  // bulk pipeline operations.
  Object.keys(unsortedPipelines.value)
    .filter((key) => !multiCamPipelineMarkers.includes(key))
    .map((value) => ({ text: pipelineTypeDisplay(value), value }))
));
const selectedPipeline: Ref<Pipe | null> = ref(null);
const pipesForSelectedType = computed(() => {
  if (!selectedPipelineType.value) {
    return null;
  }
  return unsortedPipelines.value[selectedPipelineType.value].pipes;
});
watch(selectedPipelineType, () => {
  selectedPipeline.value = null;
});

const headersTmpl: DataTableHeader[] = [
  {
    text: 'Dataset',
    value: 'name',
    sortable: true,
  },
  {
    text: 'Type',
    value: 'type',
    sortable: true,
    width: 160,
  },
  {
    text: 'fps',
    value: 'fps',
    sortable: true,
    width: 80,
  },
];
const stagedDatasetHeaders: DataTableHeader[] = headersTmpl.concat([
  {
    text: 'Remove',
    value: 'remove',
    sortable: false,
    width: 80,
  },
]);
const createNewDatasetHeaders: DataTableHeader[] = headersTmpl.concat([
  {
    text: 'Output Dataset Name',
    value: 'output',
    sortable: false,
  },
  {
    text: 'Remove',
    value: 'remove',
    sortable: false,
    width: 80,
  },
]);
function computeOutputDatasetName(item: JsonConfigCache) {
  const timeStamp = (new Date()).toISOString().replace(/[:.]/g, '-');
  return `${selectedPipeline.value?.name}_${item.name}_${timeStamp}`;
}
/** Every dataset, narrowed to stereo ones once a measurement pipeline type is chosen. */
function getAvailableItems(): JsonConfigCache[] {
  if (selectedPipelineType.value === stereoPipelineMarker) {
    // Only allow stereo datasets to be included for bulk pipeline
    // operations if the selected pipeline type is a measurement.
    return Object.values(datasets.value).filter((dataset: JsonConfigCache) => (
      dataset.type === MultiType && dataset.cameraNumber === 2
    ));
  }
  return Object.values(datasets.value);
}
const availableItems = computed(() => getAvailableItems());
const stagedDatasetIds: Ref<string[]> = ref([]);
const stagedDatasets = computed(() => availableItems.value.filter((item: JsonConfigCache) => stagedDatasetIds.value.includes(item.id)));
const stagedParentIds = computed(() => [
  ...new Set(stagedDatasetIds.value.map((id) => parentDatasetId(id))),
]);
const calibrationAvailableByDatasetId = ref<Record<string, boolean>>({});

async function refreshCalibrationForDatasets(datasetIds: string[]) {
  if (!hasCalibrationFile || !datasetIds.length) {
    return;
  }
  const parentIds = [...new Set(datasetIds.map((id) => parentDatasetId(id)))];
  const entries = await Promise.all(
    parentIds.map(async (id) => [id, await hasCalibrationFile(id)] as const),
  );
  calibrationAvailableByDatasetId.value = {
    ...calibrationAvailableByDatasetId.value,
    ...Object.fromEntries(entries),
  };
}

/** Drop staged ids that the current pipeline type no longer offers (e.g. non-stereo under measurement). */
watch(availableItems, (items) => {
  const available = new Set(items.map((item) => item.id));
  const next = stagedDatasetIds.value.filter((id) => available.has(id));
  if (next.length !== stagedDatasetIds.value.length) {
    stagedDatasetIds.value = next;
  }
});

/** Calibration status only for what is staged, not the whole library. */
watch(stagedDatasetIds, (ids) => {
  refreshCalibrationForDatasets(ids);
}, { immediate: true });

const runDisabled = computed(() => {
  if (!selectedPipeline.value || stagedDatasets.value.length === 0) {
    return true;
  }
  if (!pipelineRequiresCalibration(selectedPipeline.value)) {
    return false;
  }
  return stagedDatasets.value.some(
    (dataset) => !calibrationAvailableByDatasetId.value[parentDatasetId(dataset.id)],
  );
});

function isPipelineItemDisabledForCalibration(pipe: Pipe) {
  return pipelineDisabledForMissingCalibration(
    pipe,
    calibrationAvailableByDatasetId.value,
    stagedParentIds.value,
  );
}

function toggleStaged(item: JsonConfigCache) {
  if (stagedDatasetIds.value.includes(item.id)) {
    stagedDatasetIds.value = stagedDatasetIds.value.filter((id: string) => id !== item.id);
  } else {
    stagedDatasetIds.value = stagedDatasetIds.value.concat(item.id);
  }
}
/** Stage the picked datasets that are not staged yet. */
function stageIds(ids: string[]) {
  const staged = new Set(stagedDatasetIds.value);
  stagedDatasetIds.value = stagedDatasetIds.value.concat(ids.filter((id) => !staged.has(id)));
}
function unstageIds(ids: string[]) {
  const dropped = new Set(ids);
  stagedDatasetIds.value = stagedDatasetIds.value.filter((id) => !dropped.has(id));
}

async function runPipelineForDatasets() {
  const pipeline = selectedPipeline.value;
  if (pipeline !== null) {
    const runIds = stagedDatasets.value.map((item: JsonConfigCache) => item.id);
    const results = await Promise.allSettled(
      runIds.map((datasetId: string) => {
        if (pipelineCreatesNewDataset(pipeline)) {
          const datasetMeta = availableItems.value.find((item: JsonConfigCache) => item.id === datasetId);
          if (!datasetMeta) {
            throw new Error(`Attempted to run pipeline on nonexistant dataset ${datasetId}`);
          }
          return runPipeline(datasetId, pipeline, {
            outputDatasetName: computeOutputDatasetName(datasetMeta),
          });
        }
        return runPipeline(datasetId, pipeline);
      }),
    );
    const failed = results
      .map((result, i) => ({ result, datasetId: runIds[i] }))
      .filter(({ result }) => result.status === 'rejected');

    if (failed.length > 0) {
      prompt({
        title: 'Pipeline Errors',
        text: `Failed to run pipeline for ${failed.length} dataset${failed.length > 1 ? 's' : ''}.`,
        positiveButton: 'OK',
      });
    } else {
      router.push({ name: 'jobs' });
    }
  }
}

onBeforeMount(async () => {
  stagedDatasetIds.value = preselectedDatasetIds();
  unsortedPipelines.value = await getPipelineList();
});

</script>

<template>
  <div>
    <div class="mb-4">
      <v-card-title class="text-h4 px-0">
        Run a pipeline on multiple datasets
      </v-card-title>
      <v-card-text class="px-0">
        Choose a pipeline to run, then select datasets.
      </v-card-text>
    </div>
    <div class="mb-4">
      <v-card-title class="text-h4 px-0">
        Choose a VIAME pipeline
      </v-card-title>
      <v-card-text class="px-0">
        <v-row>
          <v-col cols="6">
            <v-select
              v-model="selectedPipelineType"
              :items="pipelineTypes"
              item-text="text"
              item-value="value"
              outlined
              persistent-hint
              dense
              label="Pipeline Type"
              hint="Select which type of pipeline to run"
            />
          </v-col>
          <v-col>
            <v-select
              v-model="selectedPipeline"
              :items="pipesForSelectedType"
              :disabled="!selectedPipelineType"
              return-object
              item-text="name"
              outlined
              persistent-hint
              dense
              label="Pipeline"
              hint="Select the pipeline to run"
            >
              <template #item="{ item, on, attrs }">
                <v-tooltip
                  left
                  :open-delay="250"
                  :disabled="!item.metadata?.description"
                  max-width="300"
                  content-class="pipeline-description-tooltip"
                >
                  <template #activator="{ on: tooltipOn, attrs: tooltipAttrs }">
                    <v-list-item
                      v-bind="{ ...attrs, ...tooltipAttrs }"
                      v-on="{ ...on, ...tooltipOn }"
                    >
                      <v-list-item-content>
                        <v-list-item-title>
                          {{ item.name }}
                          <span
                            v-if="isPipelineItemDisabledForCalibration(item)"
                            class="ml-2"
                          >
                            <PipelineCalibrationWarningIcon small />
                          </span>
                        </v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                  </template>
                  <span>{{ item.metadata?.description }}</span>
                </v-tooltip>
              </template>
            </v-select>
          </v-col>
        </v-row>
      </v-card-text>
    </div>
    <div class="mb-4">
      <v-card-title class="text-h4 px-0">
        Available datasets
      </v-card-title>
      <v-card-text class="px-0">
        Add the datasets to run the pipeline on. Measurement pipelines list stereo datasets only.
      </v-card-text>
      <DatasetPicker
        :items="availableItems"
        :selected-ids="stagedDatasetIds"
        :headers="headersTmpl"
        no-data-text="No datasets in the library are compatible with this pipeline."
        @add="stageIds([$event])"
        @add-many="stageIds"
        @remove="unstageIds([$event])"
        @remove-many="unstageIds"
      />
    </div>
    <div class="mb-4 selected-datasets">
      <v-card-title class="text-h4 px-0">
        Selected datasets
      </v-card-title>
      <v-data-table
        dense
        v-bind="{
          headers: selectedPipeline && pipelineCreatesNewDataset(selectedPipeline)
            ? createNewDatasetHeaders : stagedDatasetHeaders,
          items: stagedDatasets,
        }"
        :items-per-page.sync="clientSettings.rowsPerPage"
        hide-default-footer
        :hide-default-header="stagedDatasets.length === 0"
        no-data-text="Add datasets from the list above."
      >
        <template #[`item.remove`]="{ item }">
          <v-btn
            color="error"
            x-small
            @click="toggleStaged(item)"
          >
            <v-icon>mdi-minus</v-icon>
          </v-btn>
        </template>
        <template #[`item.output`]="{ item }">
          <b>{{ computeOutputDatasetName(item) }}</b>
        </template>
      </v-data-table>
      <v-row class="mt-4">
        <v-spacer />
        <v-col cols="auto">
          <v-btn
            :disabled="runDisabled"
            color="primary"
            :title="selectedPipeline ? '' : 'Choose a pipeline first'"
            @click="runPipelineForDatasets"
          >
            Run pipeline for ({{ stagedDatasets.length }}) Datasets
          </v-btn>
        </v-col>
      </v-row>
    </div>
  </div>
</template>
