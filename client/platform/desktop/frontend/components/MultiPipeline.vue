<script setup lang="ts">
import {
  computed,
  onBeforeMount,
  ref,
  Ref,
  watch,
} from 'vue';
import { DataTableHeader } from 'vuetify';
import { Pipe, Pipelines, useApi } from 'dive-common/apispec';
import { itemsPerPageOptions } from 'dive-common/constants';
import { clientSettings } from 'dive-common/store/settings';
import { datasets, JsonMetaCache } from '../store/dataset';

const { getPipelineList } = useApi();
const unsortedPipelines = ref({} as Pipelines);
const selectedPipelineType: Ref<string | null> = ref(null);
const pipelineTypes = computed(() => Object.keys(unsortedPipelines.value));
const selectedPipeline: Ref<Pipe | null> = ref(null);
const pipesForSelectedType = computed(() => {
  if (!selectedPipelineType.value) {
    return null;
  }
  return unsortedPipelines.value[selectedPipelineType.value].pipes;
});
watch(selectedPipelineType, () => {
  // Clear the selected pipeline if the chosen type changes
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
const availableDatasetHeaders = headersTmpl.concat(
  {
    text: 'Include',
    value: 'include',
    sortable: false,
    width: 80,
  },
);
const stagedDatasetHeaders: DataTableHeader[] = headersTmpl.concat([
  {
    text: 'Remove',
    value: 'remove',
    sortable: false,
    width: 80,
  },
]);
function getAvailableItems(): JsonMetaCache[] {
  if (!selectedPipelineType.value || !selectedPipeline.value) {
    return [];
  }
  return Object.values(datasets.value);
}
const availableItems: Ref<JsonMetaCache[]> = ref([]);
const availableDatasetSearch = ref('');
const stagedDatasetIds: Ref<string[]> = ref([]);
const stagedDatasets = computed(() => availableItems.value.filter((item: JsonMetaCache) => stagedDatasetIds.value.includes(item.id)));
watch(selectedPipeline, () => {
  availableItems.value = getAvailableItems();
});
function toggleStaged(item: JsonMetaCache) {
  if (stagedDatasetIds.value.includes(item.id)) {
    stagedDatasetIds.value = stagedDatasetIds.value.filter((id: string) => id !== item.id);
  } else {
    stagedDatasetIds.value.push(item.id);
  }
}

function runPipelineForDatasets() {
  console.log('Running pipeline...');
}

onBeforeMount(async () => {
  unsortedPipelines.value = await getPipelineList();
  availableItems.value = getAvailableItems();
});

</script>

<template>
  <div>
    <div class="mb-4">
      <v-card-title class="text-h4">
        Run a pipeline on multiple datasets
      </v-card-title>
      <v-card-text>Choose a pipeline to run, then select datasets.</v-card-text>
    </div>
    <div class="mb-4">
      <v-card-title class="text-h4">
        Choose a VIAME pipeline
      </v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="6">
            <v-select
              v-model="selectedPipelineType"
              :items="pipelineTypes"
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
              item-text="name"
              outlined
              persistent-hint
              dense
              label="Pipeline"
              hint="Select the pipeline to run"
            />
          </v-col>
        </v-row>
      </v-card-text>
      <div v-if="selectedPipeline">
        <v-card-title>Datasets staged for selected pipeline</v-card-title>
        <v-data-table
          dense
          v-bind="{ headers: stagedDatasetHeaders, items: stagedDatasets }"
          :items-per-page.sync="clientSettings.rowsPerPage"
          hide-default-footer
          :hide-default-header="stagedDatasets.length === 0"
          no-data-text="Select datasets from the table below"
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
        </v-data-table>
      </div>
      <v-row class="mt-7">
        <v-spacer />
        <v-col cols="auto">
          <v-btn
            :disabled="stagedDatasets.length === 0"
            color="primary"
            @click="runPipelineForDatasets"
          >
            Run pipeline for ({{ stagedDatasets.length }}) Datasets
          </v-btn>
        </v-col>
      </v-row>
    </div>
    <div
      v-if="selectedPipeline"
      class="mb-4"
    >
      <v-card-title class="text-h4">
        Available datasets
      </v-card-title>
      <v-card-text>These datasets are compatible with the chosen pipeline.</v-card-text>
      <v-row class="mb-2">
        <v-col cols="6">
          <v-text-field
            v-model="availableDatasetSearch"
            append-icon="mdi-magnify"
            label="Search"
            single-line
            hide-details
          />
        </v-col>
      </v-row>
      <v-data-table
        dense
        v-bind="{ headers: availableDatasetHeaders, items: availableItems }"
        :footer-props="{ itemsPerPageOptions }"
        :items-per-page.sync="clientSettings.rowsPerPage"
        :search="availableDatasetSearch"
        no-data-text="No compatible datasets found for the selected pipeline."
      >
        <template #[`item.include`]="{ item }">
          <v-btn
            :key="item.name"
            :disabled="stagedDatasetIds.includes(item.id)"
            color="success"
            x-small
            @click="toggleStaged(item)"
          >
            <v-icon>mdi-plus</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </div>
  </div>
</template>
