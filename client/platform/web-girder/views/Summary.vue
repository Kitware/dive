<script lang="ts">
import {
  defineComponent, ref, computed,
} from '@vue/composition-api';
import { itemsPerPageOptions } from 'dive-common/constants';
import { generateColors } from 'vue-media-annotator/use/useStyling';
import * as d3 from 'd3';
import { clientSettings } from 'dive-common/store/settings';
import { getLabels } from '../api';


type Label = {
  _id: string;
  count: number;
  datasets: {
    [x: string]:
    {
      id: string;
      name: string;
      color: string;
      };
  };
};
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

    const labelColors = generateColors(10);
    const ordinalColorMapper = d3.scaleOrdinal<string>().range(labelColors);

    const statsLabelStyling = computed(() => ({
      color: (label: string) => ordinalColorMapper(label),
    }));


    const updateList = async () => {
      const response = await getLabels();

      summaryList.value = response.data;

      summaryList.value.forEach((item: Label) => {
        Object.keys(item.datasets).forEach((key) => {
          // eslint-disable-next-line no-param-reassign
          item.datasets[key].color = statsLabelStyling.value.color((item.datasets[key].name));
        });
      });
    };
    updateList();


    return {
      expanded,
      summaryList,
      headers,
      clientSettings,
      itemsPerPageOptions,
    };
  },
});
</script>

<template>
  <v-data-table
    :headers="headers"
    :items="summaryList"
    :expanded.sync="expanded"
    :items-per-page.sync="clientSettings.rowsPerPage"
    :footer-props="{ itemsPerPageOptions }"
    item-key="_id"
    show-expand
  >
    <template
      v-slot:expanded-item="{ headers, item }"
    >
      <td :colspan="headers.length">
        <v-chip
          v-for="dataset in item.datasets"
          :key="dataset.id"
          class="ma-1 float-left"
          small
          :color="dataset.color"
          text-color="#000000"
          depressed
          :to="
            {
              name:
                'viewer',
              params:
                {
                  id:
                    dataset.id
                }
            }"
        >
          {{
            dataset.name
          }}
        </v-chip>
      </td>
    </template>
  </v-data-table>
</template>
