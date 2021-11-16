<script lang="ts">
import {
  defineComponent, ref, reactive, watch, toRefs,
} from '@vue/composition-api';
import type { DataOptions } from 'vuetify';
import { GirderModel, mixins } from '@girder/components/src';
import { clientSettings } from 'dive-common/store/settings';
import { itemsPerPageOptions } from 'dive-common/constants';
import { getDatasetList } from '../api';
import { useStore, LocationType } from '../store/types';

export default defineComponent({
  name: 'DataShared',
  setup() {
    const total = ref();
    const dataList = ref([] as GirderModel[]);
    const tableOptions = reactive({
      page: 1,
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
        sortBy, page, sortDesc,
      } = tableOptions;
      const limit = clientSettings.rowsPerPage;
      const offset = (page - 1) * clientSettings.rowsPerPage;
      const sort = sortBy[0] || 'created';
      const sortDir = sortDesc[0] === false ? 1 : -1;
      const shared = true;
      const response = await getDatasetList(limit, offset, sort, sortDir, shared);
      dataList.value = response.data;
      total.value = Number.parseInt(response.headers['girder-total-count'], 10);
      dataList.value.forEach((element) => {
        // eslint-disable-next-line no-param-reassign
        element.formattedSize = fixSize.formatSize(element.size);
      });
    };

    function setLocation(location: LocationType) {
      store.dispatch('Location/setRouteFromLocation', location);
    }

    function isAnnotationFolder(item: GirderModel) {
      return item._modelType === 'folder' && item.meta.annotate;
    }

    watch(tableOptions, updateOptions, {
      deep: true,
    });
    watch(() => clientSettings.rowsPerPage, updateOptions);

    updateOptions();
    return {
      isAnnotationFolder,
      dataList,
      getters,
      updateOptions,
      setLocation,
      total,
      locationStore,
      clientSettings,
      itemsPerPageOptions,
      ...toRefs(tableOptions),
      headers,
    };
  },
});

</script>

<template>
  <v-data-table
    v-model="locationStore.selected"
    :selectable="!getters['Location/locationIsViameFolder']"
    :location="locationStore.location"
    :headers="headers"
    :page.sync="page"
    :items-per-page.sync="clientSettings.rowsPerPage"
    :sort-by.sync="sortBy"
    :sort-desc.sync="sortDesc"
    :server-items-length="total"
    :items="dataList"
    :footer-props="{ itemsPerPageOptions }"
    item-key="_id"
    show-select
    @input="$emit('input', $event)"
    @update:location="setLocation"
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
      >
        Launch Annotator
      </v-btn>
    </template>
    <template #no-data>
      <span class="pr-4">No datasets have been shared with you yet.</span>
      <a href="https://kitware.github.io/dive/Web-Version/#sharing-data-with-teams">Learn more about sharing</a>
    </template>
  </v-data-table>
</template>
