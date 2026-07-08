<!--
  Parent-folder import UI. Requires `ctx`; uses discovery/rename fields from props.ctx
  and passes :ctx to ImportMultiCamCameraOrderControls and ImportMultiCamFinalizeStep.
-->
<script lang="ts">
import { defineComponent, PropType } from 'vue';
import { DatasetType } from 'dive-common/apispec';
import { ImageSequenceType } from 'dive-common/constants';
import ImportMultiCamCameraGroup from './ImportMultiCamCameraGroup.vue';
import ImportMultiCamChooseSource from './ImportMultiCamChooseSource.vue';
import ImportMultiCamChooseTransform from './ImportMultiCamChooseTransform.vue';
import ImportMultiCamCameraOrderControls from './ImportMultiCamCameraOrderControls.vue';
import ImportMultiCamFinalizeStep from './ImportMultiCamFinalizeStep.vue';
import { importMultiCamContextProp } from './importMultiCamContext';

export default defineComponent({
  name: 'ImportMultiCamSubfolders',
  components: {
    ImportMultiCamCameraGroup,
    ImportMultiCamChooseSource,
    ImportMultiCamChooseTransform,
    ImportMultiCamCameraOrderControls,
    ImportMultiCamFinalizeStep,
  },
  props: {
    ...importMultiCamContextProp,
    dataType: {
      type: String as PropType<DatasetType>,
      required: true,
    },
    stereo: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    return {
      ctx: props.ctx,
      parentFolderName: props.ctx.parentFolderName,
      subfolderLayoutLabel: props.ctx.subfolderLayoutLabel,
      orderedCameraKeys: props.ctx.orderedCameraKeys,
      subfolderOriginalNames: props.ctx.subfolderOriginalNames,
      pendingImportPayloads: props.ctx.pendingImportPayloads,
      folderList: props.ctx.folderList,
      camerasReady: props.ctx.camerasReady,
      deleteSet: props.ctx.deleteSet,
      onRenameCamera: props.ctx.onRenameCamera,
      openParentFolder: props.ctx.openParentFolder,
      open: props.ctx.open,
      showTransformFileField: props.ctx.showTransformFileField,
      openTransformFile: props.ctx.openTransformFile,
      clearTransformFile: props.ctx.clearTransformFile,
      ImageSequenceType,
    };
  },
});
</script>

<template>
  <div>
    <v-alert
      type="info"
      outlined
      dense
      class="mb-3"
    >
      Choose a parent folder with either one subfolder per camera (2 or 3 subfolders)
      or separate video files in the folder (2 or 3 videos). Subfolders without image or
      video files are ignored. Names come from the subfolder or video file name
      (letters, numbers, and underscores).
    </v-alert>
    <v-row
      no-gutters
      class="align-center mb-3"
    >
      <v-text-field
        label="Parent folder"
        placeholder="Not selected"
        disabled
        outlined
        dense
        hide-details
        :value="parentFolderName"
        class="mr-3"
      />
      <v-btn
        color="primary"
        @click="openParentFolder"
      >
        Choose parent folder
        <v-icon class="ml-2">
          mdi-folder-open
        </v-icon>
      </v-btn>
    </v-row>
    <v-alert
      v-if="subfolderLayoutLabel"
      type="success"
      outlined
      dense
      class="mb-3"
    >
      Cameras: {{ subfolderLayoutLabel }}
    </v-alert>
    <ImportMultiCamCameraGroup
      v-for="key in orderedCameraKeys"
      :key="key"
      :camera-name="key"
      :show-delete="true"
      class="mb-3"
      @delete="deleteSet(key)"
    >
      <ImportMultiCamCameraOrderControls
        :ctx="ctx"
        :camera-key="key"
      >
        <v-text-field
          :value="key"
          label="Camera name"
          hint="Used as the Girder folder name for this camera"
          persistent-hint
          dense
          outlined
          hide-details="auto"
          class="flex-grow-1"
          @change="onRenameCamera(key, $event)"
        />
      </ImportMultiCamCameraOrderControls>
      <ImportMultiCamChooseSource
        :camera-name="key"
        :data-type="dataType"
        :value="subfolderOriginalNames[key] || key"
        @open="open(dataType, key)"
        @open-text="open('text', key)"
      />
      <v-chip
        v-if="dataType === ImageSequenceType && pendingImportPayloads[key]"
        :color="pendingImportPayloads[key].jsonMeta.originalImageFiles.length ? 'success' : 'error'"
        outlined
        class="mt-2"
      >
        {{ pendingImportPayloads[key].jsonMeta.originalImageFiles.length }} files
      </v-chip>
      <ImportMultiCamChooseTransform
        v-if="folderList[key] && folderList[key].sourcePath && showTransformFileField(key)"
        :camera-name="key"
        :transform-file="folderList[key].transformFile"
        class="my-3"
        @clear="clearTransformFile(key)"
        @open="openTransformFile(key)"
      />
    </ImportMultiCamCameraGroup>
    <ImportMultiCamFinalizeStep
      v-if="camerasReady"
      :ctx="ctx"
      show-default-display-info
    />
  </div>
</template>
