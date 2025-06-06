<script lang="ts">
import {
  computed, defineComponent, onBeforeMount, ref,
} from 'vue';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { Pipelines, useApi, Pipe } from 'dive-common/apispec';
import { DataTableHeader } from 'vuetify';
import { useRouter } from 'vue-router/composables';

export default defineComponent({
  name: 'TrainedModels',
  setup() {
    const {
      getPipelineList, deleteTrainedPipeline, exportTrainedPipeline,
    } = useApi();
    const { prompt } = usePrompt();
    const router = useRouter();

    const unsortedPipelines = ref({} as Pipelines);
    const search = ref('');

    onBeforeMount(async () => {
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
        text: 'Are you sure you want to delete this model?',
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
          if (err.response?.status === 403) text = 'You do not have permission to run training on the selected resource(s).';
          prompt({
            title: 'Delete Failed',
            text,
            positiveButton: 'OK',
          });
        }
      }
    }

    async function exportModel(item: Pipe) {
      await exportTrainedPipeline(item.folderId!, item);
      router.push('/jobs');
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
        text: 'Export',
        value: 'export',
        sortable: false,
        width: 80,
      }, {
        text: 'Delete',
        value: 'delete',
        sortable: false,
        width: 80,
      },
    ];

    return {
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
      <v-card-title> Trained models </v-card-title>
      <v-card-text>
        <p>
          Below is a list of trained models that you own or are shared with you.<br>
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

        <template #[`item.export`]="{ item }">
          <v-btn
            :key="item.name"
            color="info"
            small
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
