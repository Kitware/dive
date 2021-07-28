<script lang="ts">
import {
  defineComponent, ref, reactive,
} from '@vue/composition-api';
import type { DataOptions } from 'vuetify';
import type { GirderDatasetModel } from 'platform/web-girder/constants';
import { getDatasets } from 'platform/web-girder/api/viame.service';

export default defineComponent({
  name: 'SharedData',
  props: {
    value: {
      type: Array,
      default: () => [],
    },
  },
  setup() {
    const dataList = ref([] as GirderDatasetModel[]);
    const tableOptions = reactive({ page: 1, itemsPerPage: 10 } as DataOptions);
    // const selected = ref([]);
    const headers = [
      { text: 'File Name', value: 'name' },
      { text: 'File Size', value: 'size' },
      { text: 'Shared By', value: 'creatorId' },
    ];
    const getData = async () => {
      dataList.value = await getDatasets();
    };
    getData();
    return {
      dataList,
      getData,
      tableOptions,
      headers,
      // selected,
    };
  },
});

</script>

<template>
  <div>
    <v-data-table
      :value="value"
      :headers="headers"
      :options.sync="tableOptions"
      :items="dataList"
      item-key="_id"
      show-select
      @input="$emit('input', $event)"
    />
  </div>
</template>
.
