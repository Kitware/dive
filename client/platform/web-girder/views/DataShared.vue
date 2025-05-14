<script lang="ts">
import {
  defineComponent, ref, reactive, watch, toRefs,
  Ref,
  computed,
} from 'vue';
import type { DataOptions } from 'vuetify';
import {
  GirderModel,
  mixins,
  GirderDataBrowser,
  GirderDataTable,
} from '@girder/components/src';
import { clientSettings } from 'dive-common/store/settings';
import { itemsPerPageOptions } from 'dive-common/constants';
import { getSharedWithMeFolders } from '../api';
import {
  useStore, LocationState, RootlessLocationType,
} from '../store/types';
import DataSharedBreadCrumb from './DataSharedBreadCrumb.vue';

export default defineComponent({
  name: 'DataShared',
  components: {
    GirderDataBrowser,
    GirderDataTable,
    DataSharedBreadCrumb,
  },
  setup() {
    const total = ref(0);
    const path: Ref<RootlessLocationType[]> = ref([]);

    const dataList = ref([] as GirderModel[]);
    const tableOptions = reactive({
      page: 1,
      sortBy: ['created'],
      sortDesc: [true],
    } as DataOptions);
    const store = useStore();
    const { getters } = store;
    const locationStore: LocationState = store.state.Location;
    const localLocation = ref();

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

      const response = await getSharedWithMeFolders(limit, offset, sort, sortDir);
      dataList.value = response.data;
      total.value = Number.parseInt(response.headers['girder-total-count'], 10);
      dataList.value.forEach((element) => {
        // eslint-disable-next-line no-param-reassign
        element.formattedSize = fixSize.formatSize(element.size);
      });
    };

    function setLocation(location: RootlessLocationType) {
      localLocation.value = location;
      for (let i = 0; i < path.value.length; i += 1) {
        if (path.value[i]._id === location._id) {
          path.value = path.value.slice(0, i + 1);
          return;
        }
      }
      path.value.push(location);
    }

    function resetLocation() {
      path.value = [];
    }

    function isAnnotationFolder(item: GirderModel) {
      return item._modelType === 'folder' && item.meta.annotate;
    }

    const rows = computed(() => dataList.value.map((item) => ({
      ...item,
      humanSize: fixSize.formatSize(item.size),
      icon: item.public ? 'folder' : 'folderNonPublic',
    })));

    const options = ref({
      itemsPerPage: clientSettings.rowsPerPage,
      page: 1,
    });

    watch(tableOptions, updateOptions, {
      deep: true,
    });
    watch(() => clientSettings.rowsPerPage, updateOptions);

    updateOptions();
    return {
      isAnnotationFolder,
      getters,
      setLocation,
      resetLocation,
      rows,
      total,
      locationStore,
      clientSettings,
      itemsPerPageOptions,
      options,
      notSharedLocation: localLocation,
      ...toRefs(tableOptions),
      path,
    };
  },
});

</script>

<template>
  <v-card v-if="rows.length === 0">
    <div class="no-shared">
      <span class="pr-4">No datasets have been shared with you yet.</span>
      <a href="https://kitware.github.io/dive/Web-Version/#sharing-data-with-teams">Learn more about sharing</a>
    </div>
  </v-card>
  <girder-data-table
    v-else-if="path.length === 0"
    @rowclick="setLocation"
    v-model="locationStore.selected"
    :selectable="!getters['Location/locationIsViameFolder']"
    :server-items-length="total"
    :items-per-page-options="itemsPerPageOptions"
    :options="options"
    :loading="false"
    item-key="_id"
    show-select
    :rows="rows">
    <template #header="{ props, on }">
      <thead>
        <tr
          :class="$vuetify.theme.dark ? 'darken-2' : 'lighten-5'"
          class="secondary"
        >
          <th class="pl-3 pr-0" width="1%">
            <v-checkbox
              :input-value="props.everyItem"
              class="pr-2"
              color="accent"
              hide-details="hide-details"
              @click.native="on['toggle-select-all'](!props.everyItem)"
            />
          </th>
          <th
            class="pl-3"
            colspan="10"
            width="99%"
          >
            <v-row class="ma-1">
              <data-shared-bread-crumb
                :path="path"
                :location="notSharedLocation"
                @folder-click="setLocation"
                @shared-click="resetLocation" />
              <v-spacer />
            </v-row>
          </th>
        </tr>
      </thead>
    </template>
    <template #row="{ item }">
      <span class="row-content">
        <span>{{ item.name }}</span>
        <v-icon
          v-if="getters['Jobs/datasetRunningState'](item._id)"
          color="warning"
          class="rotate"
        >
          mdi-autorenew
        </v-icon>
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
        <span class="owner-text">Shared by {{ item.ownerLogin }}</span>
      </span>
    </template>
  </girder-data-table>
  <girder-data-browser
    v-else
    v-model="locationStore.selected"
    :selectable="!getters['Location/locationIsViameFolder']"
    :location="notSharedLocation"
    :items-per-page-options="itemsPerPageOptions"
    :options="options"
    @update:location="setLocation($event)"
  >
    <template #breadcrumb>
      <data-shared-bread-crumb
        :path="path"
        :location="notSharedLocation"
        @folder-click="setLocation"
        @shared-click="resetLocation" />
    </template>
    <template #row="{ item }">
      <span>{{ item.name }}</span>
      <v-icon
        v-if="getters['Jobs/datasetRunningState'](item._id)"
        color="warning"
        class="rotate"
      >
        mdi-autorenew
      </v-icon>
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
  </girder-data-browser>
</template>

<style lang="scss" scoped>
.row-content {
  display: inline-block;
  width: 81%;

  .owner-text {
    float: right;
  }
}

.no-shared {
  padding: 20px;
}
</style>
