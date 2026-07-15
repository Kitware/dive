<!--
  Multi-folder import UI. Requires `ctx`; reads folderList, open, deleteSet, etc. from
  props.ctx and forwards ctx to ImportMultiCamCameraOrderControls when needed.
-->
<script lang="ts">
import { defineComponent, PropType } from 'vue';
import { DatasetType } from 'dive-common/apispec';
import ImportMultiCamCameraGroup from './ImportMultiCamCameraGroup.vue';
import ImportMultiCamChooseSource from './ImportMultiCamChooseSource.vue';
import ImportMultiCamChooseAnnotation from './ImportMultiCamChooseAnnotation.vue';
import ImportMultiCamChooseTransform from './ImportMultiCamChooseTransform.vue';
import ImportMultiCamAddType from './ImportMultiCamAddType.vue';
import ImportMultiCamCameraOrderControls from './ImportMultiCamCameraOrderControls.vue';
import { importMultiCamContextProp } from './importMultiCamContext';

export default defineComponent({
  name: 'ImportMultiCamMultiFolder',
  components: {
    ImportMultiCamCameraGroup,
    ImportMultiCamChooseSource,
    ImportMultiCamChooseAnnotation,
    ImportMultiCamChooseTransform,
    ImportMultiCamAddType,
    ImportMultiCamCameraOrderControls,
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
      orderedCameraKeys: props.ctx.orderedCameraKeys,
      folderList: props.ctx.folderList,
      displayKeys: props.ctx.displayKeys,
      importAnnotationFilesCheck: props.ctx.importAnnotationFilesCheck,
      deleteSet: props.ctx.deleteSet,
      addNewSet: props.ctx.addNewSet,
      open: props.ctx.open,
      openAnnotationFile: props.ctx.openAnnotationFile,
      showTransformFileField: props.ctx.showTransformFileField,
      openTransformFile: props.ctx.openTransformFile,
      clearTransformFile: props.ctx.clearTransformFile,
    };
  },
});
</script>

<template>
  <div>
    <ImportMultiCamCameraGroup
      v-for="key in orderedCameraKeys"
      :key="key"
      :camera-name="key"
      :show-delete="!stereo"
      class="mb-3"
      @delete="deleteSet(key)"
    >
      <ImportMultiCamCameraOrderControls
        v-if="orderedCameraKeys.length > 1"
        :ctx="ctx"
        :camera-key="key"
      />
      <ImportMultiCamChooseSource
        :camera-name="key"
        :data-type="dataType"
        :stereo="stereo"
        :show-delete="!stereo"
        :value="folderList[key].sourcePath"
        @open="open(dataType, key)"
        @open-text="open('text', key)"
        @delete="deleteSet(key)"
      />
      <ImportMultiCamChooseAnnotation
        v-if="folderList[key].sourcePath && importAnnotationFilesCheck"
        :camera-name="key"
        :track-file="folderList[key].trackFile"
        class="my-3"
        @clear="folderList[key].trackFile = ''"
        @open="openAnnotationFile(key)"
      />
      <ImportMultiCamChooseTransform
        v-if="folderList[key].sourcePath && showTransformFileField(key)"
        :camera-name="key"
        :transform-file="folderList[key].transformFile"
        class="my-3"
        @clear="clearTransformFile(key)"
        @open="openTransformFile(key)"
      />
    </ImportMultiCamCameraGroup>
    <ImportMultiCamAddType
      v-if="!stereo"
      :name-list="displayKeys"
      class="my-3"
      @add-new="addNewSet"
    />
  </div>
</template>
