<script lang="ts">
import { defineComponent, ref, reactive } from '@vue/composition-api';
import type { DataOptions } from 'vuetify';
import { GirderModel } from '@girder/components/src';
import { getLabels } from '../api';

export default defineComponent({
  setup() {
    const summaryList = ref();
    const expanded = ref();
    const headers = [
      { text: 'Type', value: '_id' },
      { text: 'Number of Datasets', value: 'datasets.length' },
      { text: 'Number of Tracks', value: 'count' },
      { text: '', value: 'data-table-expand' },
    ];
    const tableOptions = reactive({
      page: 1,
      sortBy: ['_id'],
    } as DataOptions);
    const updateList = async () => {
      const response = await getLabels();

      summaryList.value = response.data;
    };

    updateList();

    return {
      expanded,
      summaryList,
      headers,
    };
  },
});
</script>

<template>
  <v-data-table
    :headers="headers"
    :items="summaryList"
    :expanded.sync="expanded"
    show-expand
  >
    <template
      v-slot:expanded-item="{ headers, item }"
    >
      <td :colspan="headers.length">
        <tr
          v-for="dataset in item.datasets"
          :key="dataset.id"
        >
          {{
            dataset.name
          }}
          <v-btn
            class="ml-2"
            x-small
            color="primary"
            depressed
            :to="{ name: 'viewer', params: { id: dataset.id } }"
          >
            Launch Annotator
          </v-btn>
        </tr>
      </td>
    </template>
  </v-data-table>
</template>
