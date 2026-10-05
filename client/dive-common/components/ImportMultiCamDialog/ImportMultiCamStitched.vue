<!--
  Stitched stereo import UI: one source whose frames hold the left and right
  cameras side by side. Requires `ctx`; both folderList entries share the
  chosen source.
-->
<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';
import { DatasetType } from 'dive-common/apispec';
import ImportMultiCamCameraGroup from './ImportMultiCamCameraGroup.vue';
import ImportMultiCamChooseSource from './ImportMultiCamChooseSource.vue';
import ImportMultiCamChooseAnnotation from './ImportMultiCamChooseAnnotation.vue';
import { importMultiCamContextProp } from './importMultiCamContext';

export default defineComponent({
  name: 'ImportMultiCamStitched',
  components: {
    ImportMultiCamCameraGroup,
    ImportMultiCamChooseSource,
    ImportMultiCamChooseAnnotation,
  },
  props: {
    ...importMultiCamContextProp,
    dataType: {
      type: String as PropType<DatasetType>,
      required: true,
    },
  },
  setup(props) {
    const { folderList, orderedCameraKeys } = props.ctx;
    const sourcePath = computed(() => {
      const [first] = orderedCameraKeys.value;
      return (first && folderList.value[first]?.sourcePath) || '';
    });
    return {
      folderList,
      orderedCameraKeys,
      sourcePath,
      importAnnotationFilesCheck: props.ctx.importAnnotationFilesCheck,
      open: props.ctx.open,
      openAnnotationFile: props.ctx.openAnnotationFile,
    };
  },
});
</script>

<template>
  <div>
    <ImportMultiCamChooseSource
      camera-name="stitched"
      :data-type="dataType"
      :value="sourcePath"
      class="mb-3"
      @open="open(dataType, 'stitched')"
      @open-text="open('text', 'stitched')"
    />
    <div
      v-if="sourcePath"
      class="text-caption mb-3"
    >
      The left half of each frame loads as the left camera and the right half
      as the right camera.
    </div>
    <template v-if="sourcePath && importAnnotationFilesCheck">
      <ImportMultiCamCameraGroup
        v-for="key in orderedCameraKeys"
        :key="key"
        :camera-name="key"
        class="mb-3"
      >
        <ImportMultiCamChooseAnnotation
          :camera-name="key"
          :track-file="folderList[key].trackFile"
          class="my-3"
          @clear="folderList[key].trackFile = ''"
          @open="openAnnotationFile(key)"
        />
      </ImportMultiCamCameraGroup>
    </template>
  </div>
</template>
