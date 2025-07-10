<script lang="ts">
import {
  defineComponent, ref, PropType,
  computed,
} from 'vue';
import { DesktopMediaImportResponse } from 'platform/desktop/constants';
import { clone, cloneDeep } from 'lodash';
import ImportDialog from './ImportDialog.vue';

const headers = [
  {
    text: 'Dataset Name',
    align: 'start',
    sortable: false,
    value: 'name',
  },
  {
    text: 'Path',
    align: 'start',
    sortable: false,
    value: 'path',
  },
  {
    text: 'Dataset Type',
    align: 'start',
    sortable: false,
    value: 'jsonMeta.type',
    width: '150',
  },
  {
    text: 'Config',
    align: 'end',
    sortable: false,
    value: 'config',
  },
];

export default defineComponent({
  name: 'BulkImportDialog',
  components: {
    ImportDialog,
  },
  props: {
    importData: {
      type: Array as PropType<DesktopMediaImportResponse[]>,
      required: true,
    },
  },
  setup(props, ctx) {
    // Map imports to include generated "id" field, used in rendering.
    const imports = ref(props.importData.map((im) => {
      const cloned = cloneDeep(im);
      cloned.jsonMeta.id = (Math.random() + 1).toString(36).substring(2);

      return cloned;
    }));

    // The dataset import currently being configured
    const currentImport = ref<DesktopMediaImportResponse>();

    // Selected state and selected imports maintain the ordering of `imports`
    const selectedState = ref(imports.value.map(() => true));
    const selectedImports = computed(() => imports.value.filter((_, index) => selectedState.value[index]));
    function updateSelected(val: DesktopMediaImportResponse[]) {
      selectedState.value = imports.value.map((im) => val.includes(im));
    }

    function stripId(item: DesktopMediaImportResponse) {
      const cloned = cloneDeep(item);
      cloned.jsonMeta.id = '';
      return item;
    }

    function finalizeImport() {
      const finalImports = imports.value.filter((im) => selectedImports.value.includes(im)).map((im) => stripId(im));
      ctx.emit('finalize-import', finalImports);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function updateImportConfig(oldItem: DesktopMediaImportResponse, newItem: DesktopMediaImportResponse) {
      const itemIndex = imports.value.indexOf(oldItem);

      // Need to modify the imports array ref to contain the new item
      const newArray = clone(imports.value);
      newArray.splice(itemIndex, 1, newItem);
      imports.value = newArray;

      currentImport.value = undefined;
    }

    function formatPath(item: DesktopMediaImportResponse) {
      let path = item.jsonMeta.originalBasePath;

      if (item.jsonMeta.originalVideoFile !== '') {
        path = `${path}/${item.jsonMeta.originalVideoFile}`;
      }

      return path;
    }

    return {
      updateSelected,
      updateImportConfig,
      formatPath,
      imports,
      headers,
      selectedImports,
      currentImport,
      finalizeImport,
    };
  },
});
</script>

<template>
  <v-card outlined class="import-card" style="overflow-x: hidden;">
    <v-card-title class="text-h5">
      Bulk Import (Selecting {{ selectedImports.length }} of {{ imports.length }})
    </v-card-title>

    <v-dialog :value="currentImport !== undefined" width="800">
      <ImportDialog
        v-if="currentImport !== undefined"
        :import-data="currentImport"
        :embedded="true"
        @abort="currentImport = undefined"
        @finalize-import="updateImportConfig(currentImport, $event)"
      />
    </v-dialog>

    <v-data-table
      :value="selectedImports"
      :items="imports"
      item-key="jsonMeta.id"
      :headers="headers"
      show-select
      disable-sort
      @input="updateSelected"
    >
      <template #item.name="{ item }">
        <div class="text-wrap" style="word-break: break-word;">
          {{ item.jsonMeta.name }}
        </div>
      </template>

      <template #item.path="{ item }">
        <div class="text-wrap" style="word-break: break-word;">
          {{ formatPath(item) }}
        </div>
      </template>

      <template #item.config="{ item }">
        <v-btn
          icon
          :disabled="!selectedImports.includes(item)"
          @click="currentImport = item"
        >
          <v-icon>
            mdi-cog
          </v-icon>
        </v-btn>
      </template>
    </v-data-table>

    <v-card-text>
      <div class="d-flex flex-row mt-4">
        <v-spacer />
        <v-btn
          text
          outlined
          class="mr-5"
          @click="$emit('abort')"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          @click="finalizeImport"
        >
          Import Selected
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<style lang="scss">
@import 'dive-common/components/styles/KeyValueTable.scss';

.v-data-table__selected {
  background: unset !important;
}
</style>
