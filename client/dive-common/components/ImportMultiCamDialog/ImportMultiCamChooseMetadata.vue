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
    class="align-start"
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
      clearable
      :value="metadataFile"
      class="mr-3"
      @click:clear="$emit('clear')"
    />
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
