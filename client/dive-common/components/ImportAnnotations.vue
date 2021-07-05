<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { useApi } from 'dive-common/apispec';

export default defineComponent({
  name: 'ImportAnnotations',
  props: {
    datasetId: {
      type: String,
      default: null,
    },
    blockOnUnsaved: {
      type: Boolean,
      default: false,
    },
    buttonOptions: {
      type: Object,
      default: () => ({}),
    },
    menuOptions: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props, { emit }) {
    const { openFromDisk, importAnnotationFile } = useApi();
    const openUpload = async () => {
      const ret = await openFromDisk('annotation');
      if (!ret.canceled) {
        const path = ret.filePaths[0];
        let importFile = false;
        if (ret.fileList?.length) {
          importFile = await importAnnotationFile(props.datasetId, path, ret.fileList[0]);
        } else {
          importFile = await importAnnotationFile(props.datasetId, path);
        }
        if (importFile) {
          emit('reimport-annotation-file');
        }
      }
    };
    return {
      openUpload,
    };
  },
});
</script>

<template>
  <v-btn
    class="ma-0"
    v-bind="buttonOptions"
    :disabled="!datasetId"
    @click="openUpload"
  >
    <v-icon>
      mdi-application-import
    </v-icon>
    <span
      v-show="!$vuetify.breakpoint.mdAndDown || buttonOptions.block"
      class="pl-1"
    >
      Import
    </span>
  </v-btn>
</template>

<style scoped lang="scss">
</style>
