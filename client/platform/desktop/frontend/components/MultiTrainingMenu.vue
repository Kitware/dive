<script lang="ts">
import type { DataTableHeader } from 'vuetify';

import {
  computed, defineComponent, onBeforeMount, set, del, reactive, ref,
} from 'vue';
import {
  DatasetMeta, Pipelines, TrainingConfigs, useApi,
} from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { itemsPerPageOptions, simplifyTrainingName } from 'dive-common/constants';
import { clientSettings } from 'dive-common/store/settings';

import { useRouter } from 'vue-router/composables';
import { datasets } from '../store/dataset';

export default defineComponent({
  setup() {
    const { getPipelineList, getTrainingConfigurations, runTraining } = useApi();
    const { prompt } = usePrompt();
    const router = useRouter();

    const unsortedPipelines = ref({} as Pipelines);
    onBeforeMount(async () => {
      unsortedPipelines.value = await getPipelineList();
    });

    const trainedPipelines = computed(() => {
      if (unsortedPipelines.value.trained) {
        return unsortedPipelines.value.trained.pipes.map((item) => item.name);
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
      trainingConfigurations: {
        configs: [],
        default: '',
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

    onBeforeMount(async () => {
      const configs = await getTrainingConfigurations();
      data.trainingConfigurations = configs;
      data.selectedTrainingConfig = configs.default;
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

    async function runTrainingOnFolder() {
      try {
        await runTraining(
          stagedItems.value.map(({ id }) => id),
          data.trainingOutputName,
          data.selectedTrainingConfig,
          data.annotatedFramesOnly,
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
      toggleStaged,
      simplifyTrainingName,
      isReadyToTrain,
      runTrainingOnFolder,
      nameRules,
      itemsPerPageOptions,
      clientSettings,
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
      <v-row class="mt-4 pt-0">
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
            :items="data.trainingConfigurations.configs"
            :hint="data.selectedTrainingConfig"
            persistent-hint
          >
            <template #item="row">
              {{ simplifyTrainingName(row.item) }}
            </template>
            <template #selection="{ item }">
              {{ simplifyTrainingName(item) }}
            </template>
          </v-select>
        </v-col>
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
  </div>
</template>

<style lang="scss">
.multitraining-menu {
  .disabled-row {
    color: #444444;
  }
}
</style>
