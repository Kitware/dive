<!--
  Multicam import dialog shell: owns platform props (importMedia, stereo, …), builds shared
  dialog state via useImportMultiCamDialog() as `ctx`, passes :ctx to mode panels, and
  handles errors plus Cancel / Begin Import. See README.md § Shared context (`ctx`).
-->
<script lang="ts">
import { defineComponent, PropType } from 'vue';
import { MediaImportResponse } from 'dive-common/apispec';
import { ImageSequenceType, VideoType } from 'dive-common/constants';
import { useImportMultiCamDialog } from 'dive-common/components/ImportMultiCamDialog/useImportMultiCamDialog';
import ImportMultiCamTypeSelector from './ImportMultiCamTypeSelector.vue';
import ImportMultiCamSubfolders from './ImportMultiCamSubfolders.vue';
import ImportMultiCamMultiFolder from './ImportMultiCamMultiFolder.vue';
import ImportMultiCamKeyword from './ImportMultiCamKeyword.vue';
import ImportMultiCamFinalizeStep from './ImportMultiCamFinalizeStep.vue';
import ImportMultiCamCalibration from './ImportMultiCamCalibration.vue';

export default defineComponent({
  name: 'ImportMultiCamDialog',
  components: {
    ImportMultiCamTypeSelector,
    ImportMultiCamSubfolders,
    ImportMultiCamMultiFolder,
    ImportMultiCamKeyword,
    ImportMultiCamFinalizeStep,
    ImportMultiCamCalibration,
  },
  props: {
    stereo: {
      type: Boolean as PropType<boolean>,
      required: false,
    },
    dataType: {
      type: String as PropType<typeof VideoType | typeof ImageSequenceType>,
      default: ImageSequenceType,
    },
    importMedia: {
      type: Function as PropType<(path: string) => Promise<MediaImportResponse>>,
      required: true,
    },
    enableSubfolderImport: {
      type: Boolean,
      default: false,
    },
    registerSubfolderCameras: {
      type: Function as PropType<(assignments: {
        cameraName: string;
        sourcePath: string;
        files: File[];
      }[]) => void>,
      default: undefined,
    },
    unregisterSubfolderCamera: {
      type: Function as PropType<(sourcePath: string) => void>,
      default: undefined,
    },
    renameSubfolderCamera: {
      type: Function as PropType<(oldSourcePath: string, newSourcePath: string) => void>,
      default: undefined,
    },
  },

  setup(props, { emit }) {
    const ctx = useImportMultiCamDialog(props, emit);
    return {
      ctx,
      ...ctx,
    };
  },
});
</script>

<template>
  <v-card
    outlined
    class="import-card px-3"
  >
    <v-card-title class="text-h5">
      Import {{ stereo ? 'Stereo' : 'Multi-Camera' }}
      {{ dataType === 'image-sequence' ? 'Image Sequence' : 'Videos' }}
    </v-card-title>
    <v-card-text>
      <ImportMultiCamTypeSelector
        :ctx="ctx"
        :data-type="dataType"
        :enable-subfolder-import="enableSubfolderImport"
      />

      <ImportMultiCamSubfolders
        v-if="importType === 'subfolders'"
        :ctx="ctx"
        :data-type="dataType"
        :stereo="stereo"
      />

      <ImportMultiCamMultiFolder
        v-if="importType === 'multi'"
        :ctx="ctx"
        :data-type="dataType"
        :stereo="stereo"
      />

      <ImportMultiCamKeyword
        v-else-if="importType === 'keyword'"
        :ctx="ctx"
        :data-type="dataType"
        :stereo="stereo"
      />

      <ImportMultiCamCalibration
        v-if="importType"
        :ctx="ctx"
      />

      <div>
        <v-alert
          v-if="errorMessage"
          type="error"
          outlined
          dense
        >
          {{ errorMessage }}
        </v-alert>
      </div>

      <div v-if="nextSteps && importType !== 'subfolders'">
        <v-alert
          type="info"
          outlined
          dense
        >
          Visualization currently doesn't support multi views so please choose
          a list of images or video to display by default when viewing
        </v-alert>
        <ImportMultiCamFinalizeStep
          :ctx="ctx"
          :show-default-display="camerasReady"
        />
      </div>

      <v-row
        no-gutters
        class="align-center"
      >
        <v-checkbox
          v-if="importType"
          v-model="importAnnotationFilesCheck"
          label="Import Annotations"
          dense
          persistent-hint
        />
        <v-spacer />
        <v-btn
          text
          outlined
          class="mr-3"
          @click="$emit('abort')"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!nextSteps"
          @click="prepForImport"
        >
          Begin Import
        </v-btn>
      </v-row>
    </v-card-text>
  </v-card>
</template>

<style lang="scss" scoped>
@import 'dive-common/components/styles/KeyValueTable.scss';
</style>
