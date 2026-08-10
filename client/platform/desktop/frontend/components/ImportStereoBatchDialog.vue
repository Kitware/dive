<script lang="ts">
import { defineComponent } from 'vue';
import ImportMultiCamBatchDialog from 'dive-common/components/ImportMultiCamBatchDialog.vue';
import { MultiCamBatchCollect } from 'dive-common/multiCamBatchScan';
import * as api from '../api';
import { setRecents } from '../store/dataset';

const description = (
  'Select a top-level folder of stereo datasets. Every dataset must resolve to a left '
  + 'and a right camera; anything that does not is listed and skipped. Camera folders or '
  + 'videos named with l / left and r / right markers are paired by name, a collect folder '
  + 'holding exactly two camera folders or videos is paired in listing order, and sibling '
  + 'folders or videos in the root that differ only by an L/R marker each become one '
  + 'dataset. Calibration files next to the cameras are attached automatically.'
);

export default defineComponent({
  name: 'DesktopImportStereoBatchDialog',
  components: { ImportMultiCamBatchDialog },

  setup() {
    async function chooseAndScan() {
      const ret = await api.openFromDisk('image-sequence', true);
      if (ret.canceled || !ret.filePaths?.length) {
        return null;
      }
      return api.scanStereoBatch(ret.filePaths[0]);
    }

    async function importCollect(collect: MultiCamBatchCollect, datasetName: string) {
      if (!collect.importArgs) {
        return undefined;
      }
      const importPayload = await api.importMultiCam({
        ...collect.importArgs,
        datasetName,
      });
      const conversionArgs = await api.finalizeImport(importPayload);
      if (conversionArgs.mediaList.length > 0) {
        await api.convert(conversionArgs);
      }
      const recentsMeta = await api.loadConfig(conversionArgs.meta.id);
      setRecents(recentsMeta);
      // Batch imports skip the confirmation dialog that normally shows these.
      return importPayload.importWarnings;
    }

    return {
      chooseAndScan,
      importCollect,
      description,
    };
  },
});
</script>

<template>
  <ImportMultiCamBatchDialog
    title="Batch Stereo Import"
    :description="description"
    :choose-and-scan="chooseAndScan"
    :import-collect="importCollect"
    @abort="$emit('abort')"
  />
</template>
