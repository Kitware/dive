<!--
  Batch multicam import: pick a root folder of collect folders (collect -> camera -> images),
  review the scan/validation summary, then import one multicam dataset per valid collect,
  continuing past per-collect failures. Reuses the standard multicam import backend
  (scan-multicam-batch -> import-multicam-media -> finalize-import) so no imagery is copied.
-->
<script lang="ts">
import {
  computed, defineComponent, ref, Ref,
} from 'vue';
import { MultiCamBatchCollect, MultiCamBatchScanResult } from 'platform/desktop/constants';
import * as api from '../api';
import { setRecents } from '../store/dataset';

interface CollectStatus {
  state: 'ready' | 'blocked' | 'importing' | 'done' | 'failed';
  message?: string;
}

const headers = [
  {
    text: 'Collect', align: 'start', sortable: false, value: 'name',
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

  setup() {
    const scan: Ref<MultiCamBatchScanResult | null> = ref(null);
    const scanning = ref(false);
    const importing = ref(false);
    const finished = ref(false);
    const errorMessage: Ref<string | null> = ref(null);
    const statuses: Ref<Record<string, CollectStatus>> = ref({});

    const importableCollects = computed(() => (scan.value
      ? scan.value.collects.filter((collect) => collect.importArgs !== null)
      : []));

    const doneCount = computed(() => Object.values(statuses.value)
      .filter((status) => status.state === 'done').length);
    const failedCount = computed(() => Object.values(statuses.value)
      .filter((status) => status.state === 'failed').length);
    const blockedCount = computed(() => (scan.value
      ? scan.value.collects.length - importableCollects.value.length
      : 0));

    function resetStatuses() {
      const next: Record<string, CollectStatus> = {};
      scan.value?.collects.forEach((collect) => {
        next[collect.name] = { state: collect.importArgs ? 'ready' : 'blocked' };
      });
      statuses.value = next;
    }

    async function chooseRootFolder() {
      const ret = await api.openFromDisk('image-sequence', true);
      if (ret.canceled || !ret.filePaths?.length) {
        return;
      }
      errorMessage.value = null;
      scan.value = null;
      finished.value = false;
      scanning.value = true;
      try {
        scan.value = await api.scanMultiCamBatch(ret.filePaths[0]);
        resetStatuses();
      } catch (err) {
        errorMessage.value = String(err);
      } finally {
        scanning.value = false;
      }
    }

    async function importCollect(collect: MultiCamBatchCollect) {
      if (!collect.importArgs) {
        return;
      }
      const importPayload = await api.importMultiCam(collect.importArgs);
      const conversionArgs = await api.finalizeImport(importPayload);
      if (conversionArgs.mediaList.length > 0) {
        await api.convert(conversionArgs);
      }
      const recentsMeta = await api.loadMetadata(conversionArgs.meta.id);
      setRecents(recentsMeta);
    }

    async function runImports() {
      if (importing.value || !importableCollects.value.length) {
        return;
      }
      importing.value = true;
      errorMessage.value = null;
      // Sequential on purpose: concurrent imports can conflict behind the scenes
      // (matches bulkMediaImport) and per-collect failures must not stop the batch.
      // eslint-disable-next-line no-restricted-syntax
      for (const collect of importableCollects.value) {
        statuses.value = { ...statuses.value, [collect.name]: { state: 'importing' } };
        try {
          // eslint-disable-next-line no-await-in-loop
          await importCollect(collect);
          statuses.value = { ...statuses.value, [collect.name]: { state: 'done' } };
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
      const status = statuses.value[collect.name];
      switch (status?.state) {
        case 'importing':
          return { text: 'Importing', color: 'primary' };
        case 'done':
          return { text: 'Imported', color: 'success' };
        case 'failed':
          return { text: 'Failed', color: 'error' };
        case 'blocked':
          return { text: 'Skipped', color: 'warning' };
        default:
          return { text: 'Ready', color: 'grey darken-1' };
      }
    }

    return {
      // state
      scan,
      scanning,
      importing,
      finished,
      errorMessage,
      statuses,
      headers,
      // computed
      importableCollects,
      doneCount,
      failedCount,
      blockedCount,
      // methods
      chooseRootFolder,
      runImports,
      statusChip,
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
        camera's images. One multicam dataset is created per collect. Images are
        referenced in place and never copied.
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
          Choose Root Folder
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
              class="error--text text-caption"
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
          Imported {{ doneCount }} of {{ scan.collects.length }} collects
          <template v-if="failedCount">
            ({{ failedCount }} failed)
          </template>
          <template v-if="blockedCount">
            ({{ blockedCount }} skipped due to validation problems)
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
          @click="$emit('abort')"
        >
          {{ finished ? 'Close' : 'Cancel' }}
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!importableCollects.length || importing || finished"
          :loading="importing"
          @click="runImports"
        >
          Import {{ importableCollects.length }}
          Collect{{ importableCollects.length === 1 ? '' : 's' }}
        </v-btn>
      </v-row>
    </v-card-text>
  </v-card>
</template>
