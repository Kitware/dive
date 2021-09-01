<script lang="ts">
import {
  defineComponent, ref, reactive, computed, watch, toRefs,
} from '@vue/composition-api';
import type { DataOptions } from 'vuetify';
import { GirderModel, mixins } from '@girder/components/src';
import { getDatasetList } from '../api';
import { useStore, LocationType } from '../store/types';


export default defineComponent({
  name: 'DataShared',
  setup() {
    const total = ref();
    const dataList = ref([] as GirderModel[]);
    const tableOptions = reactive({
      page: 1,
      itemsPerPage: 10,
      sortBy: ['created'],
      sortDesc: [true],
    } as DataOptions);
    const store = useStore();
    const { getters } = store;
    const locationStore = store.state.Location;

    const headers = [
      { text: 'File Name', value: 'name' },
      { text: '', value: 'annotator', sortable: false },
      { text: 'File Size', value: 'formattedSize' },
      { text: 'Shared By', value: 'ownerLogin' },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fixSize: any = mixins.sizeFormatter.methods;

    const updateOptions = async () => {
      const {
        sortBy, page, itemsPerPage, sortDesc,
      } = tableOptions;
      const limit = itemsPerPage;
      const offset = (page - 1) * itemsPerPage;
      const sort = sortBy[0] || 'created';
      const sortDir = sortDesc[0] === false ? 1 : -1;

      const response = await getDatasetList(limit, offset, sort, sortDir, true);
      dataList.value = response.data;
      total.value = response.headers['girder-total-count'] as number;
      dataList.value.forEach((element) => {
        // eslint-disable-next-line no-param-reassign
        element.formattedSize = fixSize.formatSize(element.size);
      });
    };


    const location = computed({
      get() {
        return locationStore.location;
      },
      set(value: null | LocationType) {
        store.dispatch('Location/route', value);
      },
    });
    function isAnnotationFolder(item: GirderModel) {
      return item._modelType === 'folder' && item.meta.annotate;
    }

    watch(tableOptions, updateOptions, {
      deep: true,
    });

    updateOptions();
    return {
      isAnnotationFolder,
      dataList,
      getters,
      updateOptions,
      total,
      location,
      locationStore,
      ...toRefs(tableOptions),
      headers,
    };
  },
});

</script>

<template>
  <v-data-table
    v-model="locationStore.selected"
    :selectable="!getters.locationIsViameFolder"
    :location.sync="location"
    :headers="headers"
    :page.sync="page"
    :items-per-page.sync="itemsPerPage"
    :sort-by.sync="sortBy"
    :sort-desc.sync="sortDesc"
    :server-items-length="total"
    :items="dataList"
    item-key="_id"
    show-select
    @input="$emit('input', $event)"
  >
    <!-- eslint-disable-next-line -->
    <template v-slot:item.annotator="{item}">
      <v-btn
        v-if="isAnnotationFolder(item)"
        class="ml-2"
        x-small
        color="primary"
        depressed
        :to="{ name: 'viewer', params: { id: item._id } }"
        @click.stop="openClip(item)"
      >
        Launch Annotator
      </v-btn>
    </template>
  </v-data-table>
</template>

<style lang='scss'>
.theme--dark.v-data-table > .v-data-table__wrapper > table > thead > tr > th {
    background: var(--v-secondary-darken2);
}
</style>
