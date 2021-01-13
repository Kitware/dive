<script lang="ts">
import type { DataTableHeader, DataOptions } from 'vuetify';

import {
  computed, defineComponent, onBeforeMount, set, del, reactive, watch, toRef,
} from '@vue/composition-api';
import { DatasetMeta, TrainingConfigs, useApi } from 'viame-web-common/apispec';
import { listDatasets } from '../store/dataset';

export default defineComponent({
  setup(_, { root }) {
    const { getTrainingConfigurations, runTraining } = useApi();

    const data = reactive({
      items: [] as DatasetMeta[],
      stagedItems: {} as Record<string, DatasetMeta>,
      trainingOutputName: '',
      selectedTrainingConfig: 'foo.whatever',
      trainingConfigurations: {
        configs: ['foo.whatever', 'bar.somethingelse'],
      } as TrainingConfigs,
      // external pagination
      paginationOptions: {
        itemsPerPage: 30,
      } as DataOptions,
      serverItemsCount: 0,
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

    watch([toRef(data, 'paginationOptions')], async () => {
      const { page, itemsPerPage } = data.paginationOptions;
      const resp = await listDatasets({
        limit: itemsPerPage,
        offset: (page - 1) * itemsPerPage,
        sort: 'name',
      });
      data.items = resp.items;
      data.serverItemsCount = resp.total;
    }, { deep: true });

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

    const availableItems = computed(() => data.items.map((item) => ({
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
        );
        root.$router.push({ name: 'jobs' });
      } catch (err) {
        let text = 'Unable to run training';
        if (err.response && err.response.status === 403) {
          text = 'You do not have permission to run training on the selected resource(s).';
        }
        root.$prompt({
          title: 'Training Failed',
          text,
          positiveButton: 'OK',
        });
      }
    }

    return {
      data,
      toggleStaged,
      isReadyToTrain,
      runTrainingOnFolder,
      available: {
        items: availableItems,
        headers: headersTmpl.concat(
          {
            text: 'View',
            value: 'view',
            sortable: false,
            width: 80,
          }, {
            text: 'Include',
            value: 'action',
            sortable: false,
            width: 80,
          },
        ),
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
      <v-row class="my-4">
        <v-col sm="5">
          <v-text-field
            v-model="data.trainingOutputName"
            outlined
            dense
            hide-details
            aria-required
            label="Output Name (Required)"
          />
        </v-col>
        <v-col sm="7">
          <v-select
            v-model="data.selectedTrainingConfig"
            outlined
            dense
            hide-details
            label="Configuration File (Required)"
            :items="data.trainingConfigurations.configs"
          />
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
        :options.sync="data.paginationOptions"
        :server-items-length="data.serverItemsCount"
        :footer-props="{ itemsPerPageOptions: [30, 50, -1] }"
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