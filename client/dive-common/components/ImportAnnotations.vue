<script lang="ts">
import { defineComponent, ref } from '@vue/composition-api';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useHandler } from 'vue-media-annotator/provides';

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
  setup(props) {
    const { openFromDisk, importAnnotationFile } = useApi();
    const { reloadAnnotations } = useHandler();
    const { prompt } = usePrompt();
    const processing = ref(false);
    const openUpload = async () => {
      const ret = await openFromDisk('annotation');
      if (!ret.canceled) {
        const path = ret.filePaths[0];
        let importFile = false;
        processing.value = true;
        try {
          if (ret.fileList?.length) {
            importFile = await importAnnotationFile(props.datasetId, path, ret.fileList[0]);
          } else {
            importFile = await importAnnotationFile(props.datasetId, path);
          }
        } catch (error) {
          const text = [`Import of File ${path} failed`, error];
          prompt({
            title: 'Import Failed',
            text,
            positiveButton: 'OK',
          });
          processing.value = false;
          return;
        }
        if (importFile) {
          processing.value = false;
          await reloadAnnotations();
        }
      }
    };
    return {
      openUpload,
      processing,
    };
  },
});
</script>

<template>
  <v-tooltip bottom>
    <template #activator="{ on }">
      <v-btn
        class="ma-0"
        v-bind="buttonOptions"
        :disabled="!datasetId || processing"
        @click="openUpload"
        v-on="on"
      >
        <div>
          <v-icon>
            {{ processing ? 'mdi-spin mdi-sync' : 'mdi-application-import' }}
          </v-icon>
          <span
            v-show="!$vuetify.breakpoint.mdAndDown || buttonOptions.block"
            class="pl-1"
          >
            Import
          </span>
        </div>
      </v-btn>
    </template>
    <span> Import Annotation Data </span>
  </v-tooltip>
</template>

<style scoped lang="scss">
</style>
