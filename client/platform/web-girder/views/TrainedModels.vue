<script lang="ts">
import {
  computed, defineComponent, onBeforeMount, ref, watch,
} from 'vue';
import { isAxiosError } from 'axios';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { Pipelines, useApi, Pipe } from 'dive-common/apispec';
import { DataTableHeader } from 'vuetify';
import { useRouter } from 'vue-router/composables';
import { getUri, importModelPack } from 'platform/web-girder/api';
import { useConfig } from 'platform/web-girder/store/useConfig';

const DELETE_POLL_MS = 500;
const DELETE_POLL_ATTEMPTS = 20;

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default defineComponent({
  name: 'TrainedModels',
  setup() {
    const {
      getPipelineList, deleteTrainedPipeline, exportTrainedPipeline,
    } = useApi();
    const { prompt } = usePrompt();
    const router = useRouter();
    const { getPipelinesEnabled, getTrainingEnabled } = useConfig();

    const unsortedPipelines = ref({} as Pipelines);
    const search = ref('');
    const importDialog = ref(false);
    const archive = ref<File | null>(null);
    const fileInput = ref<HTMLInputElement | null>(null);
    const busy = ref(false);
    const error = ref('');
    const toast = ref(false);
    const toastMessage = ref('');
    /** Bytes uploaded so far; null when not uploading. */
    const uploadLoaded = ref<number | null>(null);
    const uploadTotal = ref<number | undefined>(undefined);

    const uploadPercent = computed(() => {
      if (uploadLoaded.value === null) return 0;
      const total = uploadTotal.value;
      if (!total) return 0;
      return Math.min(100, Math.round((uploadLoaded.value / total) * 100));
    });

    const uploadIndeterminate = computed(() => (
      busy.value && (uploadLoaded.value === null
        || !uploadTotal.value
        || uploadPercent.value >= 100)
    ));

    const uploadLabel = computed(() => {
      if (!busy.value) return '';
      if (uploadLoaded.value === null) return 'Preparing upload…';
      if (!uploadTotal.value) return `Uploading ${formatBytes(uploadLoaded.value)}…`;
      if (uploadPercent.value >= 100) return 'Importing model pack…';
      return `Uploading ${formatBytes(uploadLoaded.value)} of ${formatBytes(uploadTotal.value)} (${uploadPercent.value}%)`;
    });

    function openFilePicker() {
      error.value = '';
      fileInput.value?.click();
    }

    function onFilePicked(event: Event) {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0] ?? null;
      // Allow picking the same file again after cancel/reopen.
      input.value = '';
      if (!file) return;
      archive.value = file;
      uploadLoaded.value = null;
      uploadTotal.value = undefined;
      importDialog.value = true;
    }

    function closeImportDialog() {
      if (busy.value) return;
      importDialog.value = false;
    }

    watch(importDialog, (open) => {
      if (open || busy.value) return;
      archive.value = null;
      error.value = '';
      uploadLoaded.value = null;
      uploadTotal.value = undefined;
    });

    async function importModel() {
      if (!archive.value) return;
      busy.value = true;
      error.value = '';
      uploadLoaded.value = 0;
      uploadTotal.value = archive.value.size || undefined;
      try {
        await importModelPack(archive.value, (loaded, total) => {
          uploadLoaded.value = loaded;
          uploadTotal.value = total ?? archive.value?.size;
        });
        unsortedPipelines.value = await getPipelineList();
        importDialog.value = false;
        archive.value = null;
        uploadLoaded.value = null;
        uploadTotal.value = undefined;
      } catch (err) {
        error.value = isAxiosError(err) ? (err.response?.data?.message || err.message) : String(err);
      } finally {
        busy.value = false;
      }
    }

    function exportZip(item: Pipe) {
      window.location.assign(getUri({ url: `folder/${item.folderId}/download` }));
    }

    onBeforeMount(async () => {
      if (!getPipelinesEnabled() && !getTrainingEnabled()) {
        router.push('/');
        return;
      }
      unsortedPipelines.value = await getPipelineList();
    });

    const trainedModels = computed(() => {
      if (unsortedPipelines.value.trained) {
        return unsortedPipelines.value.trained.pipes;
      }
      return [];
    });

    function packStillListed(pipelines: Pipelines, folderId: string | undefined) {
      return !!pipelines.trained?.pipes?.some((pipe) => pipe.folderId === folderId);
    }

    async function waitUntilPackGone(folderId: string | undefined, name: string) {
      /* Sequential polls until Girder finishes deleting the pack. */
      /* eslint-disable no-await-in-loop */
      for (let attempt = 0; attempt < DELETE_POLL_ATTEMPTS; attempt += 1) {
        const pipelines = await getPipelineList();
        unsortedPipelines.value = pipelines;
        if (!packStillListed(pipelines, folderId)) {
          toastMessage.value = `Deleted "${name}"`;
          toast.value = true;
          return;
        }
        await sleep(DELETE_POLL_MS);
      }
      /* eslint-enable no-await-in-loop */
      toastMessage.value = `"${name}" is still deleting; refresh if it remains.`;
      toast.value = true;
    }

    async function deleteModel(item: Pipe) {
      const confirmDelete = await prompt({
        title: `Delete "${item.name}" model`,
        text: 'Delete this model pack, including all of its pipelines, weights, and supporting files?',
        positiveButton: 'Delete',
        negativeButton: 'Cancel',
        confirm: true,
      });

      if (confirmDelete) {
        busy.value = true;
        try {
          // Girder 5 queues folder deletion; poll until the pack leaves the list.
          await deleteTrainedPipeline(item);
          await waitUntilPackGone(item.folderId, item.name);
        } catch (err) {
          let text = 'Unable to delete model';
          if (isAxiosError(err) && err.response?.status === 403) text = 'You do not have permission to delete the selected model pack.';
          prompt({
            title: 'Delete Failed',
            text,
            positiveButton: 'OK',
          });
        } finally {
          busy.value = false;
        }
      }
    }

    async function exportModel(item: Pipe) {
      if (!item.onnxConvertible) return;
      try {
        await exportTrainedPipeline(item.folderId!, item);
        router.push('/jobs');
      } catch (err) {
        prompt({
          title: 'Conversion Failed',
          text: isAxiosError(err) ? (err.response?.data?.message || err.message) : String(err),
          positiveButton: 'OK',
        });
      }
    }

    async function browseModel(item: Pipe) {
      router.push(`/folder/${item.folderId}`);
    }

    function onnxTooltip(item: Pipe) {
      return item.onnxConvertible
        ? 'Convert to ONNX'
        : 'ONNX conversion requires a .weights, .ckpt, or .pth file in the model pack';
    }

    const trainedHeadersTmpl: DataTableHeader[] = [
      {
        text: 'Model',
        value: 'name',
        sortable: true,
      },
      {
        text: 'Owner',
        value: 'ownerLogin',
        sortable: true,
      },
      {
        text: 'Browse',
        value: 'browse',
        sortable: false,
        width: 80,
      },
      {
        text: 'Export to ZIP',
        value: 'zip',
        sortable: false,
        width: 120,
      },
      {
        text: 'Convert to ONNX',
        value: 'export',
        sortable: false,
        width: 160,
      }, {
        text: 'Delete',
        value: 'delete',
        sortable: false,
        width: 80,
      },
    ];

    return {
      fileInput,
      importDialog,
      archive,
      busy,
      error,
      toast,
      toastMessage,
      uploadPercent,
      uploadIndeterminate,
      uploadLabel,
      openFilePicker,
      onFilePicked,
      closeImportDialog,
      importModel,
      exportZip,
      deleteModel,
      exportModel,
      browseModel,
      onnxTooltip,
      items: trainedModels,
      headers: trainedHeadersTmpl,
      search,
    };
  },
});
</script>

<template>
  <v-container :fluid="$vuetify.breakpoint.mdAndDown">
    <input
      ref="fileInput"
      type="file"
      accept=".zip,application/zip"
      class="d-none"
      aria-hidden="true"
      tabindex="-1"
      @change="onFilePicked"
    >
    <v-card class="trained-models-wrapper mt-4 pa-6">
      <v-card-title>
        Trained Models
        <v-spacer />
        <v-btn color="primary" :disabled="busy" @click="openFilePicker">
          <v-icon left>
            mdi-import
          </v-icon>
          Import
        </v-btn>
      </v-card-title>
      <v-dialog v-model="importDialog" max-width="550" :persistent="busy">
        <v-card>
          <v-card-title>Import model ZIP</v-card-title>
          <v-card-text>
            <p class="mb-3">
              Choose a ZIP containing pipeline files and model weights.
            </p>
            <div v-if="archive" class="d-flex align-center mb-3">
              <v-icon left>
                mdi-folder-zip
              </v-icon>
              <span class="text-truncate">{{ archive.name }}</span>
              <v-spacer />
              <v-btn text small :disabled="busy" @click="openFilePicker">
                Change
              </v-btn>
            </div>
            <template v-if="busy">
              <div class="text-caption mb-1">
                {{ uploadLabel }}
              </div>
              <v-progress-linear
                :value="uploadPercent"
                :indeterminate="uploadIndeterminate"
                height="8"
                rounded
                aria-label="Upload progress"
              />
            </template>
            <v-alert v-if="error" type="error" class="mt-3">
              {{ error }}
            </v-alert>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn text :disabled="busy" @click="closeImportDialog">
              Cancel
            </v-btn>
            <v-btn color="primary" :disabled="!archive || busy" :loading="busy" @click="importModel">
              Import
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
      <v-card-text>
        <p>
          Below is a list of trained models that you own or are shared with you.
          It doesn't include pretrained models provided by VIAME.
        </p>
      </v-card-text>

      <template v-if="items.length > 0">
        <v-text-field
          v-model="search"
          label="Search..."
          prepend-inner-icon="mdi-magnify"
          density="compact"
          variant="solo-filled"
          single-line
        />
      </template>

      <v-data-table
        v-bind="{ headers: headers, items: items }"
        no-data-text="You don't have any trained model"
        :search="search"
      >
        <template #[`item.browse`]="{ item }">
          <v-btn
            :key="item.name"
            color="info"
            small
            :disabled="busy"
            @click="browseModel(item)"
          >
            <v-icon>mdi-folder</v-icon>
          </v-btn>
        </template>

        <template #[`item.zip`]="{ item }">
          <v-btn color="info" small :disabled="busy" title="Export to ZIP" aria-label="Export to ZIP" @click="exportZip(item)">
            <v-icon>mdi-folder-zip</v-icon>
          </v-btn>
        </template>

        <template #[`item.export`]="{ item }">
          <v-tooltip bottom max-width="280">
            <template #activator="{ on, attrs }">
              <span
                class="d-inline-block"
                v-bind="attrs"
                v-on="on"
              >
                <v-btn
                  :key="item.name"
                  color="info"
                  small
                  :disabled="busy || !item.onnxConvertible"
                  aria-label="Convert to ONNX"
                  @click="exportModel(item)"
                >
                  <v-icon>mdi-export</v-icon>
                </v-btn>
              </span>
            </template>
            <span>{{ onnxTooltip(item) }}</span>
          </v-tooltip>
        </template>

        <template #[`item.delete`]="{ item }">
          <v-btn
            :key="item.name"
            color="error"
            small
            :disabled="busy"
            @click="deleteModel(item)"
          >
            <v-icon>mdi-trash-can</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>
    <v-snackbar v-model="toast" :timeout="4000" bottom right>
      {{ toastMessage }}
    </v-snackbar>
  </v-container>
</template>

<style lang="scss" scoped>
.trained-models-wrapper {
  max-width: 1200px;
  margin: auto;
}
</style>
