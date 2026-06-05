<script lang="ts">
import {
  defineComponent, ref, reactive, watch, toRefs,
} from 'vue';
import type { DataOptions } from 'vuetify';
import { formatSize, type GirderModel } from '@girder/components';
import { clientSettings } from 'dive-common/store/settings';
import { itemsPerPageOptions } from 'dive-common/constants';
import {
  getMultiCamIcon,
  getMultiCamSubType,
  getMultiCamTooltip,
} from 'dive-common/multicamDisplay';
import { getSharedWithMeFolders } from '../api';
import { useLocation } from '../store/useLocation';

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
    const {
      location, selected, locationIsViameFolder,
    } = useLocation();

    const headers = [
      { text: 'File Name', value: 'name' },
      { text: 'Type', value: 'type' },
      { text: 'File Size', value: 'formattedSize' },
      { text: 'Shared By', value: 'ownerLogin' },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fixSize = formatSize;

    const updateOptions = async () => {
      const {
        sortBy, page, sortDesc,
      } = tableOptions;
      const limit = clientSettings.rowsPerPage;
      const offset = (page - 1) * clientSettings.rowsPerPage;
      const sort = sortBy[0] || 'created';
      const sortDir = sortDesc[0] === false ? 1 : -1;
      const response = await getSharedWithMeFolders(limit, offset, sort, sortDir);
      dataList.value = response.data;
      total.value = Number.parseInt(response.headers['girder-total-count'], 10);
      dataList.value.forEach((element) => {
        // eslint-disable-next-line no-param-reassign
        element.formattedSize = fixSize.formatSize(element.size);
        // eslint-disable-next-line no-param-reassign
        element.type = isAnnotationFolder(element) ? 'Dataset' : 'Folder';
      });
    };

    function isAnnotationFolder(item: GirderModel) {
      return item._modelType === 'folder' && item.meta.annotate;
    }

    function multiCamSubType(item: GirderModel) {
      return getMultiCamSubType(item.meta);
    }

    watch(tableOptions, updateOptions, {
      deep: true,
    });
    watch(() => clientSettings.rowsPerPage, updateOptions);

    updateOptions();
    return {
      isAnnotationFolder,
      multiCamSubType,
      getMultiCamIcon,
      getMultiCamTooltip,
      dataList,
      updateOptions,
      total,
      location,
      selected,
      locationIsViameFolder,
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
    v-model="selected"
    v-model:page="page"
    v-model:items-per-page="clientSettings.rowsPerPage"
    v-model:sort-by="sortBy"
    v-model:sort-desc="sortDesc"
    :selectable="!locationIsViameFolder"
    :headers="headers"
    :server-items-length="total"
    :items="dataList"
    :footer-props="{ itemsPerPageOptions }"
    item-key="_id"
    show-select
  >
    <!-- eslint-disable-next-line -->
    <template v-slot:item.name="{ item }">
      <div
        class="filename"
        @click="$router.push({ name: 'home', params: { routeType: 'folder', routeId: item._id } })"
      >
        <v-tooltip
          v-if="multiCamSubType(item)"
          bottom
        >
          <template #activator="{ props }">
            <v-icon
              small
              class="mr-1"
              v-bind="props"
            >
              {{ getMultiCamIcon(multiCamSubType(item)) }}
            </v-icon>
          </template>
          <span>{{ getMultiCamTooltip(multiCamSubType(item)) }}</span>
        </v-tooltip>
        <v-icon class="mr-1">
          mdi-folder{{ item.public ? '' : '-key' }}
        </v-icon>
        {{ item.name }}
      </div>
    </template>
    <template #item.type="{ item }">
      {{ item.type }}
      <v-btn
        v-if="isAnnotationFolder(item)"
        class="ml-2"
        x-small
        color="primary"
        variant="flat"
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

<style lang="scss" scoped>
.filename {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  opacity: 0.8;

  &:hover {
    opacity: 1;
  }
}
</style>
