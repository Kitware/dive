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
    const {
      calibrationFile,
      lastCalibrationFileName,
      calibrationAutoDiscoveryFailed,
      showLastCalibrationSuggestion,
      open,
      clearCalibration,
      applyLastCalibration,
    } = props.ctx;
    return {
      calibrationFile,
      lastCalibrationFileName,
      calibrationAutoDiscoveryFailed,
      showLastCalibrationSuggestion,
      open,
      clearCalibration,
      applyLastCalibration,
    };
  },
});
</script>

<template>
  <div>
    <v-alert
      v-if="showLastCalibrationSuggestion"
      type="info"
      outlined
      dense
      class="mb-3"
    >
      <template v-if="calibrationAutoDiscoveryFailed">
        No calibration file was found in the parent folder.
      </template>
      <template v-else>
        No calibration file selected.
      </template>
      You can use your last calibration file
      <strong v-if="lastCalibrationFileName">({{ lastCalibrationFileName }})</strong>
      or choose a different one.
      <div class="mt-2">
        <v-btn
          small
          color="primary"
          class="mr-2"
          @click="applyLastCalibration"
        >
          Use last calibration
        </v-btn>
        <v-btn
          small
          outlined
          @click="open('calibration', 'calibration')"
        >
          Choose calibration
        </v-btn>
      </div>
    </v-alert>
    <v-row
      no-gutters
      class="align-center my-3"
    >
      <v-text-field
        label="Calibration File"
        placeholder="Not selected"
        readonly
        outlined
        dense
        hide-details
        :value="calibrationFile"
        class="mr-3"
      />
      <v-btn
        v-if="calibrationFile"
        icon
        class="mr-2"
        aria-label="Clear calibration file"
        @click="clearCalibration"
      >
        <v-icon>mdi-close</v-icon>
      </v-btn>
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
  </div>
</template>
