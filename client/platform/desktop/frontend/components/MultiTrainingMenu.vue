<script lang="ts">
import type { DataTableHeader } from 'vuetify';

import {
  computed,
  defineComponent,
  onBeforeMount,
  set,
  del,
  reactive,
  ref,
  watch,
} from 'vue';
import {
  DatasetMeta, Pipelines, TrainingConfigs, useApi, Pipe,
} from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { itemsPerPageOptions, simplifyTrainingName } from 'dive-common/constants';
import { clientSettings } from 'dive-common/store/settings';

import { useRouter } from 'vue-router/composables';
import npath from 'path';
import { dialog, app } from '@electron/remote';
import { datasets } from '../store/dataset';

export default defineComponent({
  setup() {
    const {
      runTraining, getPipelineList, deleteTrainedPipeline, getTrainingConfigurations, exportTrainedPipeline,
    } = useApi();
    const { prompt } = usePrompt();
    const router = useRouter();

    const unsortedPipelines = ref({} as Pipelines);
    const labelFile = ref(null as File | null);
    const labelText = ref('');

    function clearLabelText() {
      labelText.value = '';
    }

    watch(labelFile, () => {
      if (labelFile.value) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          labelText.value = evt.target?.result as string;
        };
        reader.readAsText(labelFile.value);
      }
    });

    onBeforeMount(async () => {
      unsortedPipelines.value = await getPipelineList();
    });

    const trainedPipelines = computed(() => {
      if (unsortedPipelines.value.trained) {
        return unsortedPipelines.value.trained.pipes.map((item) => item.name);
      }
      return [];
    });

    const trainedModels = computed(() => {
      if (unsortedPipelines.value.trained) {
        return unsortedPipelines.value.trained.pipes;
      }
      return [];
    });

    const nameRules = [
      (val: string) => (!trainedPipelines.value.includes(val) || 'A Trained pipeline with that name already exists'),
    ];

    const data = reactive({
      stagedItems: {} as Record<string, DatasetMeta>,
      trainingOutputName: '',
      selectedTrainingConfig: 'foo.whatever',
      fineTuneTraining: false,
      selectedFineTune: null as null | string,
      trainingConfigurations: {
        training: {
          configs: [],
          default: '',
        },
        models: {},
      } as TrainingConfigs,
      annotatedFramesOnly: false,
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

    const trainedHeadersTmpl: DataTableHeader[] = [
      {
        text: 'Model',
        value: 'name',
        sortable: true,
      },
    ];

    onBeforeMount(async () => {
      const configs = await getTrainingConfigurations();
      data.trainingConfigurations = configs;
      data.selectedTrainingConfig = configs.training.default;
    });

    const modelNames = computed(() => {
      if (data.trainingConfigurations.models) {
        const list = Object.entries(data.trainingConfigurations.models)
          .map(([, value]) => value.name);
        return list;
      }
      return [];
    });

    function toggleStaged(meta: DatasetMeta) {
      if (data.stagedItems[meta.id]) {
        del(data.stagedItems, meta.id);
      } else {
        set(data.stagedItems, meta.id, meta);
      }
    }
    const availableItems = computed(() => Object.values(datasets.value)
      .filter((item) => item.subType === null)
      .map((item) => ({
        ...item,
        included: item.id in data.stagedItems,
      })));

    const stagedItems = computed(() => Object.values(data.stagedItems));

    const isReadyToTrain = computed(() => (
      stagedItems.value.length > 0
        && data.selectedTrainingConfig
        && data.trainingOutputName
    ));

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
          if (err.response?.status === 403) text = 'You do not have permission to delete the selected resource(s).';
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
        const location = await dialog.showSaveDialog({
          title: 'Export Model',
          defaultPath: npath.join(app.getPath('home'), 'model.onnx'),
        });
        if (!location.canceled && location.filePath) {
          await exportTrainedPipeline(location.filePath!, item);
          const goToJobsPage = !await prompt({
            title: 'Export Started',
            text: 'You can check the export status in the Jobs tab.',
            negativeButton: 'View',
            positiveButton: 'OK',
            confirm: true,
          });
          if (goToJobsPage) {
            router.push('/jobs');
          }
        }
      } catch (err) {
        const errorTemplate = 'Unable to export model';
        let text = `${errorTemplate}: ${err}`;
        if (err.response?.status === 403) text = `${errorTemplate}: You do not have permission to export the selected resource(s).`;
        prompt({
          title: 'Export Failed',
          text,
          positiveButton: 'OK',
        });
      }
    }

    async function runTrainingOnFolder() {
      // Get the full data for fine tuning
      let foundTrainingModel;
      if (data.fineTuneTraining) {
        foundTrainingModel = Object.values(data.trainingConfigurations.models)
          .find((item) => item.name === data.selectedFineTune);
      }
      try {
        runTraining(
          stagedItems.value.map(({ id }) => id),
          data.trainingOutputName,
          data.selectedTrainingConfig,
          data.annotatedFramesOnly,
          labelText.value || undefined,
          foundTrainingModel,
        );
        router.push({ name: 'jobs' });
      } catch (err) {
        let text = 'Unable to run training';
        if (err.response && err.response.status === 403) {
          text = 'You do not have permission to run training on the selected resource(s).';
        }
        prompt({
          title: 'Training Failed',
          text,
          positiveButton: 'OK',
        });
      }
    }

    return {
      data,
      labelFile,
      clearLabelText,
      toggleStaged,
      deleteModel,
      exportModel,
      simplifyTrainingName,
      isReadyToTrain,
      runTrainingOnFolder,
      nameRules,
      itemsPerPageOptions,
      clientSettings,
      modelNames,
      models: {
        items: trainedModels,
        headers: trainedHeadersTmpl.concat({
          text: 'Export',
          value: 'export',
          sortable: false,
          width: 80,
        }, {
          text: 'Delete',
          value: 'delete',
          sortable: false,
          width: 80,
        }),
      },
      available: {
        items: availableItems,
        headers: headersTmpl.concat({
          text: 'View',
          value: 'view',
          sortable: false,
          width: 80,
        }, {
          text: 'Include',
          value: 'action',
          sortable: false,
          width: 80,
        }),
      },
      staged: {
        items: stagedItems,
        headers: headersTmpl.concat({
          text: 'Exclude',
          value: 'action',
          sortable: false,
          width: 80,
        }),
      },
    };
  },
});
</script>

<template>
  <div class="multitraining-menu">
    <div class="mb-4">
      <v-card-title class="text-h4">
        Staged for training ({{ staged.items.value.length }})
      </v-card-title>
      <v-card-text>
        Add datasets to the staging area and choose a training configuration.
      </v-card-text>
      <v-row
        class="mt-4 pt-0"
        dense
      >
        <v-col sm="5">
          <v-text-field
            v-model="data.trainingOutputName"
            :rules="nameRules"
            outlined
            dense
            aria-required
            label="Output Name (Required)"
          />
        </v-col>
        <v-col sm="7">
          <v-select
            v-model="data.selectedTrainingConfig"
            outlined
            dense
            label="Configuration File (Required)"
            :items="data.trainingConfigurations.training.configs"
            item-text="name"
            item-value="name"
            :hint="data.selectedTrainingConfig"
            persistent-hint
          >
            <template #item="{ item, on, attrs }">
              <v-tooltip
                left
                :disabled="!item.description"
                max-width="300"
                content-class="training-config-tooltip"
              >
                <template #activator="{ on: tooltipOn, attrs: tooltipAttrs }">
                  <v-list-item
                    v-bind="{ ...attrs, ...tooltipAttrs }"
                    v-on="{ ...on, ...tooltipOn }"
                  >
                    <v-list-item-content>
                      <v-list-item-title>{{ simplifyTrainingName(item.name) }}</v-list-item-title>
                    </v-list-item-content>
                  </v-list-item>
                </template>
                <span>{{ item.description }}</span>
              </v-tooltip>
            </template>
            <template #selection="{ item }">
              {{ simplifyTrainingName(item.name) }}
            </template>
          </v-select>
        </v-col>
      </v-row>
      <v-row
        class="my-4 pt-0"
        dense
      >
        <v-col sm="5">
          <v-file-input
            v-model="labelFile"
            icon="mdi-folder-open"
            label="Labels.txt mapping file (optional)"
            hint="Combine or rename output classes using a labels.txt file"
            persistant-hint
            dense
            outlined
            hide-details
            clearable
            @click:clear="clearLabelText"
          />
        </v-col>
        <v-spacer />
      </v-row>
      <v-data-table
        v-bind="{ headers: staged.headers, items: staged.items.value }"
        hide-default-footer
        dense
        :hide-default-header="staged.items.value.length === 0"
        no-data-text="No data chosen for training."
      >
        <template #[`item.action`]="{ item }">
          <v-btn
            :key="item.name"
            color="error"
            x-small
            @click="toggleStaged(item)"
          >
            <v-icon>mdi-minus</v-icon>
          </v-btn>
        </template>
      </v-data-table>
      <div class="d-flex flex-row mt-7">
        <v-checkbox
          v-model="data.annotatedFramesOnly"
          label="Use annotated frames only"
          dense
          hint="Train only on frames with groundtruth and ignore frames without annotations"
          persistent-hint
          class="py-0 my-0"
        />
        <v-spacer />
        <v-btn
          :disabled="!isReadyToTrain"
          color="primary"
          @click="runTrainingOnFolder"
        >
          Train on ({{ staged.items.value.length }}) Datasets
        </v-btn>
      </div>
      <div class="d-flex flex-row mt-7">
        <v-checkbox
          v-model="data.fineTuneTraining"
          label="Fine Tuning"
          hint="Fine tune an existing model"
        />
        <v-spacer />
        <v-select
          v-if="data.fineTuneTraining"
          v-model="data.selectedFineTune"
          :items="modelNames"
          label="Fine Tune Model"
        />
      </div>
    </div>
    <div>
      <v-card-title class="text-h4">
        Available for training
      </v-card-title>
      <v-card-text>
        These datasets meet the requirements for the chosen training configuration.
      </v-card-text>
      <v-data-table
        dense
        v-bind="{ headers: available.headers, items: available.items.value }"
        :footer-props="{ itemsPerPageOptions }"
        :items-per-page.sync="clientSettings.rowsPerPage"
        :item-class="({ included }) => included ? 'disabled-row' : ''"
        no-data-text="No data meets criteria for chosen configuration"
      >
        <template #[`item.action`]="{ item }">
          <v-btn
            :key="item.name"
            :disabled="item.included"
            color="success"
            x-small
            @click="toggleStaged(item)"
          >
            <v-icon>mdi-plus</v-icon>
          </v-btn>
        </template>
        <template #[`item.view`]="{ item }">
          <v-btn
            :key="item.name"
            :disabled="item.included"
            color="info"
            x-small
            @click="$router.push({ name: 'viewer', params: { id: item.id } })"
          >
            <v-icon>mdi-eye</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </div>

    <div>
      <v-card-title class="text-h4">
        Trained models
      </v-card-title>
      <v-card-text>
        Here are all your trained models
      </v-card-text>
      <v-data-table
        dense
        v-bind="{ headers: models.headers, items: models.items.value }"
        no-data-text="You don't have any trained model"
      >
        <template #[`item.export`]="{ item }">
          <v-btn
            :key="item.name"
            color="info"
            x-small
            @click="exportModel(item)"
          >
            <v-icon>mdi-export</v-icon>
          </v-btn>
        </template>

        <template #[`item.delete`]="{ item }">
          <v-btn
            :key="item.name"
            color="error"
            x-small
            @click="deleteModel(item)"
          >
            <v-icon>mdi-trash-can</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </div>
  </div>
</template>

<style lang="scss">
.multitraining-menu {
  .disabled-row {
    color: #444444;
  }
}

.training-config-tooltip.v-tooltip__content {
  background: #3a3a3a !important;
  opacity: 1 !important;
}
</style>
