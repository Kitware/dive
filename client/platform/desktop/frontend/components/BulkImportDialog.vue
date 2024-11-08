<script lang="ts">
import {
  computed, defineComponent, ref, PropType,
  reactive,
} from 'vue';
import { DesktopMediaImportResponse } from 'platform/desktop/constants';
import ImportDialog from './ImportDialog.vue';

export default defineComponent({
  name: 'BulkImportDialog',
  components: {
    ImportDialog,
  },
  props: {
    imports: {
      type: Array as PropType<DesktopMediaImportResponse[]>,
      required: true,
    },
  },
  setup(props, ctx) {
    const importResults = reactive(ref([] as DesktopMediaImportResponse[]));
    const index = computed(() => importResults.value.length);
    const currentImport = computed(() => props.imports[index.value]);
    const embeddedData = computed(() => ({
      showNext: index.value < props.imports.length - 1,
      showBack: index.value !== 0,
    }));

    function finalizeImport(importResponse: DesktopMediaImportResponse) {
      importResults.value.push(importResponse);

      // Once all have been finalized, emit the import
      if (importResults.value.length === props.imports.length) {
        ctx.emit('finalize-import', importResults.value);
      }
    }

    function goBack() {
      const val = importResults.value.pop();

      // If undefined, it means no value existing in array to remove
      if (val === undefined) {
        ctx.emit('abort');
      }
    }

    return {
      index,
      embeddedData,
      currentImport,
      importResults,
      finalizeImport,
      goBack,
    };
  },
});
</script>

<template>
  <v-card
    outlined
    class="import-card"
    style="overflow-x: hidden;"
  >
    <v-card-title class="text-h5">
      Bulk Import ({{ index + 1 }} of {{ imports.length }})
    </v-card-title>

    <ImportDialog
      v-if="currentImport !== undefined"
      :import-data="currentImport"
      :embedded-data="embeddedData"
      @finalize-import="finalizeImport($event)"
      @abort="goBack"
    />
  </v-card>
</template>

<style scoped lang="scss">
@import 'dive-common/components/styles/KeyValueTable.scss';
</style>
