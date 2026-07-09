<!--
  Optional per-camera transform/calibration file picker with clear and open
  actions. Shown for cameras after the first; the desktop backend parses the
  file at import time and seeds the dataset's saved camera calibration (the
  same calibration the in-app panel edits and the Align button applies).
  Accepts a DIVE calibration .json.
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
      label="Transform file (.json)"
      :placeholder="`Transform mapping the first camera to ${cameraName}`"
      hint="Optional: DIVE calibration .json"
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
