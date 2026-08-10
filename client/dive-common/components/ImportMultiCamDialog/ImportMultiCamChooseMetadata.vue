<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'ImportMultiCamChooseMetadata',
  props: {
    metadataFile: {
      type: String,
      default: '',
    },
  },
});
</script>

<template>
  <v-row
    class="align-center"
    no-gutters
  >
    <v-text-field
      label="Camera Metadata File (Optional)"
      placeholder="Not selected"
      hint="A JSON, TXT, or CSV attachment for this camera. Pipelines that request it receive it;
        rows in a TXT/CSV that match this camera's media are shown per frame."
      persistent-hint
      readonly
      outlined
      dense
      :value="metadataFile"
      class="mr-3"
    />
    <v-btn
      v-if="metadataFile"
      icon
      class="mr-2"
      aria-label="Clear camera metadata file"
      @click="$emit('clear')"
    >
      <v-icon>mdi-close</v-icon>
    </v-btn>
    <v-btn
      color="primary"
      @click="$emit('open')"
    >
      Choose metadata
      <v-icon class="ml-2">
        mdi-file-cog
      </v-icon>
    </v-btn>
  </v-row>
</template>
