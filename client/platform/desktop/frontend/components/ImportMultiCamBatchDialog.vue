<script lang="ts">
import { defineComponent } from 'vue';
import ImportMultiCamBatchDialog from 'dive-common/components/ImportMultiCamBatchDialog.vue';
import { MultiCamBatchCollect } from 'dive-common/multiCamBatchScan';
import * as api from '../api';
import { setRecents } from '../store/dataset';

export default defineComponent({
  name: 'DesktopImportMultiCamBatchDialog',
  components: { ImportMultiCamBatchDialog },

  setup() {
    async function chooseAndScan() {
      const ret = await api.openFromDisk('image-sequence', true);
      if (ret.canceled || !ret.filePaths?.length) {
        return null;
      }
      return api.scanMultiCamBatch(ret.filePaths[0]);
    }

    async function importCollect(collect: MultiCamBatchCollect, datasetName: string) {
      if (!collect.importArgs) {
        return;
      }
      const importPayload = await api.importMultiCam({
        ...collect.importArgs,
        datasetName,
      });
      const conversionArgs = await api.finalizeImport(importPayload);
      if (conversionArgs.mediaList.length > 0) {
        await api.convert(conversionArgs);
      }
      const recentsMeta = await api.loadMetadata(conversionArgs.meta.id);
      setRecents(recentsMeta);
    }

    return {
      chooseAndScan,
      importCollect,
    };
  },
});
</script>

<template>
  <ImportMultiCamBatchDialog
    :choose-and-scan="chooseAndScan"
    :import-collect="importCollect"
    @abort="$emit('abort')"
  />
</template>
