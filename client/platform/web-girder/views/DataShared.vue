<script lang="ts">
import {
  defineComponent, ref, reactive, computed,
} from '@vue/composition-api';
import type { DataOptions } from 'vuetify';
import { GirderModel, GirderModelType, mixins } from '@girder/components/src';
import type { GirderDatasetModel } from 'platform/web-girder/constants';
import { getDatasets } from 'platform/web-girder/api/viame.service';
import { useStore } from 'platform/web-girder/store/types';


export default defineComponent({
  name: 'DataShared',

  setup() {
    const dataList = ref([] as GirderDatasetModel[]);
    const tableOptions = reactive({ page: 1, itemsPerPage: 10 } as DataOptions);
    const store = useStore();
    const { getters } = store;
    const locationStore = store.state.Location;

    const headers = [
      { text: 'File Name', value: 'name' },
      { text: '', value: 'annotator', sortable: false },
      { text: 'File Size', value: 'formattedSize' },
      { text: 'Shared By', value: 'creatorId' },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fixSize: any = mixins.sizeFormatter.methods;

    const getData = async () => {
      dataList.value = await getDatasets(true);
      dataList.value.forEach((element) => {
        // eslint-disable-next-line no-param-reassign
        element.formattedSize = fixSize.formatSize(element.size);
      });
    };

    const location = computed({
      get() {
        return locationStore.location;
      },
      set(value: null | GirderModel | { type: GirderModelType }) {
        store.dispatch('Location/route', value);
      },
    });
    function isAnnotationFolder(item: GirderDatasetModel) {
      return item._modelType === 'folder' && item.meta.annotate;
    }


    getData();
    return {
      isAnnotationFolder,
      dataList,
      getters,
      getData,
      location,
      locationStore,
      tableOptions,
      headers,
    };
  },
});

</script>

<template>
  <div>
    <v-data-table
      v-model="locationStore.selected"
      :selectable="!getters.locationIsViameFolder"
      :location.sync="location"
      :headers="headers"
      :options.sync="tableOptions"
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
  </div>
</template>
