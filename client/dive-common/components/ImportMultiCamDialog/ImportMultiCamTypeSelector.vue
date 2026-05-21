<!--
  Radio group to choose import mode: multi-folder, parent subfolders, or glob keyword.
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
  },
  setup(props) {
    const { importType, clearCameraSet } = props.ctx;
    return { importType, clearCameraSet };
  },
});
</script>

<template>
  <div v-if="dataType === 'image-sequence' || enableSubfolderImport">
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
        label="Parent folder: each immediate subfolder is a camera"
      />
      <v-radio
        v-if="dataType === 'image-sequence'"
        value="keyword"
        label="Glob Filter: Use pattern matching to deteremine left and right camera"
      />
    </v-radio-group>
  </div>
</template>
