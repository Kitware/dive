<!--
  Optional per-dataset metadata file picker (e.g. sea-lion flight log). Requires
  `ctx`; uses metadataFile and open from ctx. Unlike calibration this is not gated
  to stereo datasets.
-->
<script lang="ts">
import { defineComponent } from 'vue';
import { importMultiCamContextProp } from './importMultiCamContext';

export default defineComponent({
  name: 'ImportMultiCamMetadata',
  props: {
    ...importMultiCamContextProp,
  },
  setup(props) {
    const {
      metadataFile,
      open,
      clearMetadataFile,
    } = props.ctx;
    return {
      metadataFile,
      open,
      clearMetadataFile,
    };
  },
});
</script>

<template>
  <v-row
    no-gutters
    class="align-center my-3"
  >
    <v-text-field
      label="Metadata File (Optional)"
      placeholder="Not selected"
      readonly
      outlined
      dense
      hide-details
      :value="metadataFile"
      hint="A .json, .txt, or .csv file passed to pipelines that request it."
      class="mr-3"
    />
    <v-btn
      v-if="metadataFile"
      icon
      class="mr-2"
      aria-label="Clear metadata file"
      @click="clearMetadataFile"
    >
      <v-icon>mdi-close</v-icon>
    </v-btn>
    <v-btn
      color="primary"
      @click="open('metadata', 'metadata')"
    >
      Choose metadata
      <v-icon class="ml-2">
        mdi-file-cog
      </v-icon>
    </v-btn>
  </v-row>
</template>
