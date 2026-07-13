<!--
  Batch multicam import: pick a root folder of collect folders (collect -> camera -> images),
  review the scan/validation summary, then import one multicam dataset per valid collect,
  continuing past per-collect failures.
-->
<script lang="ts">
import {
  computed, defineComponent, PropType, ref, Ref,
} from 'vue';
import {
  MultiCamBatchCollect,
  MultiCamBatchScanResult,
} from 'dive-common/multiCamBatchScan';

interface CollectStatus {
  state: 'ready' | 'blocked' | 'importing' | 'done' | 'failed';
  /** Failure detail, or non-fatal warnings for a completed import. */
  message?: string;
}

const headers = [
  {
    text: '', align: 'center', sortable: false, value: 'selected', width: '48',
  },
  {
    text: 'Dataset Name', align: 'start', sortable: false, value: 'name',
  },
  {
    text: 'Cameras', align: 'start', sortable: false, value: 'cameras',
  },
  {
    text: 'Issues', align: 'start', sortable: false, value: 'issues',
  },
  {
    text: 'Status', align: 'start', sortable: false, value: 'status', width: '160',
  },
];

export default defineComponent({
  name: 'ImportMultiCamBatchDialog',

  props: {
    chooseAndScan: {
      type: Function as PropType<() => Promise<MultiCamBatchScanResult | null>>,
      required: true,
    },
    importCollect: {
      type: Function as PropType<(
        collect: MultiCamBatchCollect,
        datasetName: string,
      ) => Promise<string[] | undefined>>,
      required: true,
    },
    chooseFolderLabel: {
      type: String,
      default: 'Choose Root Folder',
    },
  },

  setup(props) {
    const scan: Ref<MultiCamBatchScanResult | null> = ref(null);
    const scanning = ref(false);
    const importing = ref(false);
    const finished = ref(false);
    const errorMessage: Ref<string | null> = ref(null);
    const statuses: Ref<Record<string, CollectStatus>> = ref({});
    const selectedState: Ref<Record<string, boolean>> = ref({});
    const datasetNames: Ref<Record<string, string>> = ref({});

    const importableCollects = computed(() => (scan.value
      ? scan.value.collects.filter((collect) => collect.importArgs !== null)
      : []));

    const selectedImportableCollects = computed(() => importableCollects.value
      .filter((collect) => selectedState.value[collect.name]));

    const allImportableSelected = computed(() => {
      const importable = importableCollects.value;
      return importable.length > 0
        && importable.every((collect) => selectedState.value[collect.name]);
    });

    const someImportableSelected = computed(() => {
      const importable = importableCollects.value;
      const selectedCount = importable
        .filter((collect) => selectedState.value[collect.name]).length;
      return selectedCount > 0 && selectedCount < importable.length;
    });

    const canImport = computed(() => selectedImportableCollects.value.length > 0
      && selectedImportableCollects.value.every(
        (collect) => (datasetNames.value[collect.name] || '').trim().length > 0,
      ));

    const doneCount = computed(() => Object.values(statuses.value)
      .filter((status) => status.state === 'done').length);
    const failedCount = computed(() => Object.values(statuses.value)
      .filter((status) => status.state === 'failed').length);
    const blockedCount = computed(() => (scan.value
      ? scan.value.collects.length - importableCollects.value.length
      : 0));
    const notImportedCount = computed(() => importableCollects.value
      .filter((collect) => !selectedState.value[collect.name]).length);

    function resetAfterScan() {
      const nextStatuses: Record<string, CollectStatus> = {};
      const nextSelected: Record<string, boolean> = {};
      const nextDatasetNames: Record<string, string> = {};
      scan.value?.collects.forEach((collect) => {
        nextStatuses[collect.name] = { state: collect.importArgs ? 'ready' : 'blocked' };
        nextSelected[collect.name] = collect.importArgs !== null;
        nextDatasetNames[collect.name] = collect.name;
      });
      statuses.value = nextStatuses;
      selectedState.value = nextSelected;
      datasetNames.value = nextDatasetNames;
    }

    function toggleSelectAll(selected: boolean) {
      const next = { ...selectedState.value };
      importableCollects.value.forEach((collect) => {
        next[collect.name] = selected;
      });
      selectedState.value = next;
    }

    function setSelected(name: string, selected: boolean) {
      selectedState.value = { ...selectedState.value, [name]: selected };
    }

    async function chooseRootFolder() {
      errorMessage.value = null;
      scan.value = null;
      finished.value = false;
      scanning.value = true;
      try {
        scan.value = await props.chooseAndScan();
        if (scan.value) {
          resetAfterScan();
        }
      } catch (err) {
        errorMessage.value = String(err);
      } finally {
        scanning.value = false;
      }
    }

    async function runImports() {
      if (importing.value || !canImport.value) {
        return;
      }
      importing.value = true;
      errorMessage.value = null;
      // Sequential on purpose: concurrent imports can conflict behind the scenes
      // and per-collect failures must not stop the batch.
      // eslint-disable-next-line no-restricted-syntax
      for (const collect of selectedImportableCollects.value) {
        statuses.value = { ...statuses.value, [collect.name]: { state: 'importing' } };
        const datasetName = (datasetNames.value[collect.name] || collect.name).trim();
        try {
          // eslint-disable-next-line no-await-in-loop
          const warnings = await props.importCollect(collect, datasetName);
          statuses.value = {
            ...statuses.value,
            [collect.name]: {
              state: 'done',
              ...(warnings?.length ? { message: warnings.join(' ') } : {}),
            },
          };
        } catch (err) {
          statuses.value = {
            ...statuses.value,
            [collect.name]: { state: 'failed', message: String(err) },
          };
        }
      }
      importing.value = false;
      finished.value = true;
    }

    function statusChip(collect: MultiCamBatchCollect): { text: string; color: string } {
      if (!collect.importArgs) {
        return { text: 'Skipped', color: 'warning' };
      }
      if (!selectedState.value[collect.name]) {
        return { text: finished.value ? 'Not imported' : 'Not selected', color: 'grey darken-1' };
      }
      const status = statuses.value[collect.name];
      switch (status?.state) {
        case 'importing':
          return { text: 'Importing', color: 'primary' };
        case 'done':
          return { text: 'Imported', color: 'success' };
        case 'failed':
          return { text: 'Failed', color: 'error' };
        default:
          return { text: 'Ready', color: 'grey darken-1' };
      }
    }

    return {
      scan,
      scanning,
      importing,
      finished,
      errorMessage,
      statuses,
      selectedState,
      datasetNames,
      headers,
      importableCollects,
      selectedImportableCollects,
      allImportableSelected,
      someImportableSelected,
      canImport,
      doneCount,
      failedCount,
      blockedCount,
      notImportedCount,
      chooseRootFolder,
      runImports,
      statusChip,
      toggleSelectAll,
      setSelected,
    };
  },
});
</script>

<template>
  <v-card
    outlined
    class="import-card"
  >
    <v-card-title class="text-h5">
      Batch Multicam Import
    </v-card-title>
    <v-card-text>
      <p class="grey--text text--lighten-1">
        Select a top-level folder whose subfolders are collects; each collect must
        contain the same camera subfolders (for example EO, IR, UV) holding that
        camera's images. One multicam dataset is created per collect. DIVE
        registration .json files found next to a collect's camera folders are
        attached automatically and seed that dataset's camera registration.
      </p>
      <v-row
        no-gutters
        class="align-center mb-3"
      >
        <v-btn
          color="primary"
          :disabled="scanning || importing"
          @click="chooseRootFolder"
        >
          <v-icon class="mr-2">
            mdi-folder-multiple-image
          </v-icon>
          {{ chooseFolderLabel }}
        </v-btn>
        <span
          v-if="scan"
          class="ml-4 grey--text"
        >
          {{ scan.rootPath }}
        </span>
      </v-row>
      <v-progress-linear
        v-if="scanning"
        indeterminate
        color="light-blue"
        class="mb-3"
      />
      <v-alert
        v-if="errorMessage"
        type="error"
        outlined
        dense
      >
        {{ errorMessage }}
      </v-alert>
      <template v-if="scan">
        <v-alert
          v-for="problem in scan.problems"
          :key="problem"
          type="error"
          outlined
          dense
        >
          {{ problem }}
        </v-alert>
        <div
          v-if="scan.cameraNames.length"
          class="mb-2"
        >
          <span class="mr-2">Cameras:</span>
          <v-chip
            v-for="camera in scan.cameraNames"
            :key="camera"
            small
            class="mr-1"
          >
            {{ camera }}
          </v-chip>
        </div>
        <v-data-table
          :headers="headers"
          :items="scan.collects"
          item-key="name"
          disable-sort
          disable-pagination
          hide-default-footer
          dense
        >
          <template #header.selected>
            <v-simple-checkbox
              :value="allImportableSelected"
              :indeterminate="someImportableSelected"
              :disabled="!importableCollects.length || importing || finished"
              @input="toggleSelectAll"
            />
          </template>
          <template #item.selected="{ item }">
            <v-simple-checkbox
              v-if="item.importArgs"
              :value="selectedState[item.name]"
              :disabled="importing || finished"
              @input="setSelected(item.name, $event)"
            />
          </template>
          <template #item.name="{ item }">
            <template v-if="item.importArgs">
              <v-text-field
                v-model="datasetNames[item.name]"
                dense
                hide-details
                placeholder="Dataset name"
                :disabled="importing || finished || !selectedState[item.name]"
              />
              <div class="grey--text text-caption">
                Collect folder: {{ item.name }}
              </div>
            </template>
            <span
              v-else
              class="grey--text"
            >{{ item.name }}</span>
          </template>
          <template #item.cameras="{ item }">
            <span v-if="item.cameras.length">
              <v-chip
                v-for="camera in item.cameras"
                :key="camera.name"
                x-small
                class="mr-1"
              >
                {{ camera.name }} ({{ camera.imageCount }})
              </v-chip>
            </span>
            <span
              v-else
              class="grey--text"
            >none</span>
            <div
              v-if="item.transformFiles.length"
              class="grey--text text-caption"
            >
              Registration: {{ item.transformFiles.join(', ') }}
            </div>
          </template>
          <template #item.issues="{ item }">
            <div
              v-for="problem in item.problems"
              :key="`problem-${problem}`"
              class="error--text text-caption"
            >
              {{ problem }}
            </div>
            <div
              v-for="warning in item.warnings"
              :key="`warning-${warning}`"
              class="warning--text text-caption"
            >
              {{ warning }}
            </div>
            <div
              v-if="statuses[item.name] && statuses[item.name].message"
              class="text-caption"
              :class="statuses[item.name].state === 'done' ? 'warning--text' : 'error--text'"
            >
              {{ statuses[item.name].message }}
            </div>
          </template>
          <template #item.status="{ item }">
            <v-chip
              small
              outlined
              :color="statusChip(item).color"
            >
              {{ statusChip(item).text }}
            </v-chip>
          </template>
        </v-data-table>
        <v-alert
          v-if="finished"
          :type="failedCount ? 'warning' : 'success'"
          outlined
          dense
          class="mt-3"
        >
          Imported {{ doneCount }} of {{ selectedImportableCollects.length }} selected collects
          <template v-if="failedCount">
            ({{ failedCount }} failed)
          </template>
          <template v-if="blockedCount">
            ({{ blockedCount }} skipped due to validation problems)
          </template>
          <template v-if="notImportedCount">
            ({{ notImportedCount }} not selected)
          </template>
        </v-alert>
      </template>
      <v-row
        no-gutters
        class="align-center mt-4"
      >
        <v-spacer />
        <v-btn
          text
          outlined
          class="mr-3"
          :disabled="importing"
          @click="$emit('abort', doneCount)"
        >
          {{ finished ? 'Close' : 'Cancel' }}
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!canImport || importing || finished"
          :loading="importing"
          @click="runImports"
        >
          Import {{ selectedImportableCollects.length }}
          Collect{{ selectedImportableCollects.length === 1 ? '' : 's' }}
        </v-btn>
      </v-row>
    </v-card-text>
  </v-card>
</template>
