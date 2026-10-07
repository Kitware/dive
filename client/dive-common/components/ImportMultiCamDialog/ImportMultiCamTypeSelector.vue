<!--
  Radio group to choose import mode: multi-folder, parent subfolders, glob keyword, or stitched stereo.
  Requires `ctx` (ImportMultiCamContext); uses ctx.importType and ctx.clearCameraSet.
-->
<script lang="ts">
import { defineComponent } from 'vue';
import { importMultiCamContextProp } from './importMultiCamContext';

export default defineComponent({
  name: 'ImportMultiCamTypeSelector',
  props: {
    ...importMultiCamContextProp,
    dataType: {
      type: String,
      required: true,
    },
    enableSubfolderImport: {
      type: Boolean,
      default: false,
    },
    stereo: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const { importType, clearCameraSet } = props.ctx;
    return { importType, clearCameraSet };
  },
});
</script>

<template>
  <div v-if="dataType === 'image-sequence' || enableSubfolderImport || stereo">
    <v-radio-group
      v-model="importType"
      label="How do you want to choose each camera?"
      @change="clearCameraSet"
    >
      <v-radio
        value="multi"
        label="Multi-Folder: Choose a folder or image list for each camera"
      />
      <v-radio
        v-if="enableSubfolderImport"
        value="subfolders"
        label="Parent folder: subfolders or separate video files per camera"
      />
      <v-radio
        v-if="dataType === 'image-sequence'"
        value="keyword"
        label="Glob Filter: Use pattern matching to deteremine left and right camera"
      />
      <v-radio
        v-if="stereo"
        value="stitched"
        :label="dataType === 'video'
          ? 'Stitched: One video with the left and right cameras side by side in each frame'
          : 'Stitched: One folder or image list with the left and right cameras side by side in each image'"
      />
    </v-radio-group>
  </div>
</template>
