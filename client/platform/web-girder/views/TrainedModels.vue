<script lang="ts">
import {
  computed, defineComponent, onBeforeMount, ref,
} from 'vue';
import { isAxiosError } from 'axios';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { Pipelines, useApi, Pipe } from 'dive-common/apispec';
import { DataTableHeader } from 'vuetify';
import { useRouter } from 'vue-router/composables';
import { getUri, importModelPack } from 'platform/web-girder/api';
import { useConfig } from 'platform/web-girder/store/useConfig';

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
    const busy = ref(false);
    const error = ref('');

    async function importModel() {
      if (!archive.value) return;
      busy.value = true;
      error.value = '';
      try {
        await importModelPack(archive.value);
        unsortedPipelines.value = await getPipelineList();
        importDialog.value = false;
        archive.value = null;
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

    async function deleteModel(item: Pipe) {
      const confirmDelete = await prompt({
        title: `Delete "${item.name}" model`,
        text: 'Delete this model pack, including all of its pipelines, weights, and supporting files?',
        positiveButton: 'Delete',
        negativeButton: 'Cancel',
        confirm: true,
      });

      if (confirmDelete) {
        try {
          await deleteTrainedPipeline(item);
          unsortedPipelines.value = await getPipelineList();
        } catch (err) {
          let text = 'Unable to delete model';
          if (isAxiosError(err) && err.response?.status === 403) text = 'You do not have permission to delete the selected model pack.';
          prompt({
            title: 'Delete Failed',
            text,
            positiveButton: 'OK',
          });
        }
      }
    }

    async function exportModel(item: Pipe) {
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
      importDialog,
      archive,
      busy,
      error,
      importModel,
      exportZip,
      deleteModel,
      exportModel,
      browseModel,
      items: trainedModels,
      headers: trainedHeadersTmpl,
      search,
    };
  },
});
</script>

<template>
  <v-container :fluid="$vuetify.breakpoint.mdAndDown">
    <v-card class="trained-models-wrapper mt-4 pa-6">
      <v-card-title>
        Trained Models
        <v-spacer />
        <v-btn color="primary" :disabled="busy" @click="error = ''; importDialog = true">
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
            Choose a ZIP containing pipeline files and model weights.
            <v-file-input v-model="archive" accept=".zip" label="Model ZIP" :disabled="busy" />
            <v-alert v-if="error" type="error">
              {{ error }}
            </v-alert>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn text :disabled="busy" @click="importDialog = false">
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
            @click="browseModel(item)"
          >
            <v-icon>mdi-folder</v-icon>
          </v-btn>
        </template>

        <template #[`item.zip`]="{ item }">
          <v-btn color="info" small title="Export to ZIP" aria-label="Export to ZIP" @click="exportZip(item)">
            <v-icon>mdi-folder-zip</v-icon>
          </v-btn>
        </template>

        <template #[`item.export`]="{ item }">
          <v-btn
            :key="item.name"
            color="info"
            small
            title="Convert to ONNX"
            aria-label="Convert to ONNX"
            @click="exportModel(item)"
          >
            <v-icon>mdi-export</v-icon>
          </v-btn>
        </template>

        <template #[`item.delete`]="{ item }">
          <v-btn
            :key="item.name"
            color="error"
            small
            @click="deleteModel(item)"
          >
            <v-icon>mdi-trash-can</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>
  </v-container>
</template>

<style lang="scss" scoped>
.trained-models-wrapper {
  max-width: 1200px;
  margin: auto;
}
</style>
