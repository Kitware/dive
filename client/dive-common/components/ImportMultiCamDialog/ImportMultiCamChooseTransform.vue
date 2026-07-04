<!--
  Optional per-camera ITK transform (.h5) file picker with clear and open actions.
  Shown for cameras after the first; the desktop backend parses the file at import
  time and stores the reduced 3x3 matrix on the dataset's multicam metadata.
-->
<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  props: {
    transformFile: String,
    cameraName: String,
  },
});
</script>

<template>
  <v-row
    class="align-center"
    no-gutters
  >
    <v-text-field
      label="ITK Transform File (.h5)"
      :placeholder="`Transform mapping the first camera to ${cameraName}`"
      hint="Optional registration transform from itk_point_set_to_transform"
      persistent-hint
      outlined
      dense
      clearable
      :value="transformFile"
      class="mr-3"
      @click:clear="$emit('clear')"
    />
    <v-btn
      color="primary"
      @click="$emit('open')"
    >
      Open
      <v-icon class="ml-2">
        mdi-matrix
      </v-icon>
    </v-btn>
  </v-row>
</template>
