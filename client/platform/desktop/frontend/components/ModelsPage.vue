<script lang="ts">
import {
  computed, defineComponent, onBeforeMount, ref,
} from 'vue';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { Pipelines, useApi, Pipe } from 'dive-common/apispec';
import { DataTableHeader } from 'vuetify';
import { useRouter } from 'vue-router/composables';
import NavigationBar from './NavigationBar.vue';

export default defineComponent({
  name: 'ModelsPage',
  components: { NavigationBar },
  setup() {
    const {
      getPipelineList, deleteTrainedPipeline, exportTrainedPipeline,
    } = useApi();
    const { prompt } = usePrompt();
    const router = useRouter();

    const unsortedPipelines = ref({} as Pipelines);
    const search = ref('');
    const busy = ref(false);
    const error = ref('');

    async function refresh() {
      unsortedPipelines.value = await getPipelineList();
    }
    onBeforeMount(refresh);

    async function importModel() {
      const selected = await window.diveDesktop.showOpenDialog({
        title: 'Import model ZIP',
        filters: [{ name: 'Model ZIP', extensions: ['zip'] }],
        properties: ['openFile'],
      });
      if (selected.canceled || !selected.filePaths.length) return;
      busy.value = true;
      error.value = '';
      try {
        await window.diveDesktop.invoke('import-model-pack', selected.filePaths[0]);
        await refresh();
      } catch (err) {
        error.value = String(err);
      } finally {
        busy.value = false;
      }
    }

    async function exportZip(item: Pipe) {
      const selected = await window.diveDesktop.showSaveDialog({
        title: 'Export model to ZIP',
        defaultPath: `${item.name}.zip`,
        filters: [{ name: 'Model ZIP', extensions: ['zip'] }],
      });
      if (selected.canceled || !selected.filePath) return;
      busy.value = true;
      error.value = '';
      try {
        await window.diveDesktop.invoke('export-model-pack', item, selected.filePath);
      } catch (err) {
        error.value = String(err);
      } finally {
        busy.value = false;
      }
    }

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
          text = `${text}: ${err}`;
          prompt({
            title: 'Delete Failed',
            text,
            positiveButton: 'OK',
          });
        }
      }
    }

    async function exportModel(item: Pipe) {
      const selected = await window.diveDesktop.showSaveDialog({
        title: 'Convert model to ONNX',
        defaultPath: 'model.onnx',
        filters: [{ name: 'ONNX model', extensions: ['onnx'] }],
      });
      if (selected.canceled || !selected.filePath) return;
      try {
        await exportTrainedPipeline(selected.filePath, item);
        router.push('/jobs');
      } catch (err) {
        error.value = String(err);
      }
    }

    const trainedHeadersTmpl: DataTableHeader[] = [
      {
        text: 'Model',
        value: 'name',
        sortable: true,
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
      busy,
      error,
      importModel,
      exportZip,
      deleteModel,
      exportModel,
      items: trainedModels,
      headers: trainedHeadersTmpl,
      search,
    };
  },
});
</script>

<template>
  <v-main>
    <navigation-bar />
    <v-container :fluid="$vuetify.breakpoint.mdAndDown">
      <v-card class="trained-models-wrapper mt-4 pa-6">
        <v-card-title>
          Trained Models
          <v-spacer />
          <v-btn color="primary" :disabled="busy" @click="importModel">
            <v-icon left>
              mdi-import
            </v-icon>
            Import
          </v-btn>
        </v-card-title>
        <v-card-text>
          <p>Below is a list of your trained and imported models. It doesn't include pretrained models provided by VIAME.</p>
          <v-alert v-if="error" type="error" dismissible>
            {{ error }}
          </v-alert>
          <v-progress-linear v-if="busy" indeterminate />
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
          <template #[`item.zip`]="{ item }">
            <v-btn color="info" small :disabled="busy" title="Export to ZIP" aria-label="Export to ZIP" @click="exportZip(item)">
              <v-icon>mdi-folder-zip</v-icon>
            </v-btn>
          </template>

          <template #[`item.export`]="{ item }">
            <v-btn
              :key="item.name"
              :disabled="busy"
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
              :disabled="busy"
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
  </v-main>
</template>

<style lang="scss" scoped>
.trained-models-wrapper {
  max-width: 1200px;
  margin: auto;
}
</style>
