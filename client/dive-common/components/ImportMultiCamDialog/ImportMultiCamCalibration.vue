<!--
  Stereoscopic calibration file picker. Requires `ctx`; uses calibrationFile and open from ctx.
-->
<script lang="ts">
import { defineComponent } from 'vue';
import { importMultiCamContextProp } from './importMultiCamContext';

export default defineComponent({
  name: 'ImportMultiCamCalibration',
  props: {
    ...importMultiCamContextProp,
  },
  setup(props) {
    const { calibrationFile, open } = props.ctx;
    return {
      calibrationFile,
      open,
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
      label="Calibration File"
      placeholder="Not selected"
      disabled
      outlined
      dense
      hide-details
      :value="calibrationFile"
      class="mr-3"
    />
    <v-btn
      color="primary"
      @click="open('calibration', 'calibration')"
    >
      Choose calibration
      <v-icon class="ml-2">
        mdi-matrix
      </v-icon>
    </v-btn>
  </v-row>
</template>
