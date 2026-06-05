<!--
  Dataset name, default display, and calibration UI. Requires `ctx`; reads finalize
  fields from props.ctx (datasetName, defaultDisplay, open, …).
-->
<script lang="ts">
import { defineComponent } from 'vue';
import { importMultiCamContextProp } from './importMultiCamContext';

export default defineComponent({
  name: 'ImportMultiCamFinalizeStep',
  props: {
    ...importMultiCamContextProp,
    stereo: {
      type: Boolean,
      default: false,
    },
    showDatasetName: {
      type: Boolean,
      default: true,
    },
    showDefaultDisplayInfo: {
      type: Boolean,
      default: false,
    },
    showDefaultDisplay: {
      type: Boolean,
      default: true,
    },
  },
  setup(props) {
    const {
      datasetName,
      datasetNameRules,
      defaultDisplay,
      displayKeys,
      displayKeysKey,
      calibrationFile,
      open,
    } = props.ctx;
    return {
      datasetName,
      datasetNameRules,
      defaultDisplay,
      displayKeys,
      displayKeysKey,
      calibrationFile,
      open,
    };
  },
});
</script>

<template>
  <div>
    <v-text-field
      v-if="showDatasetName"
      v-model="datasetName"
      label="Dataset name"
      placeholder="Parent folder name in Girder"
      hint="A new folder with this name will contain all cameras"
      persistent-hint
      outlined
      dense
      class="mb-4"
      :class="{ 'mt-2': showDefaultDisplayInfo }"
      :rules="datasetNameRules"
    />
    <v-alert
      v-if="showDefaultDisplayInfo"
      type="info"
      outlined
      dense
      class="mb-3"
    >
      Choose which camera to use as the default display when viewing the dataset.
    </v-alert>
    <v-radio-group
      v-if="showDefaultDisplay"
      :key="displayKeysKey"
      v-model="defaultDisplay"
      label="Default Display"
    >
      <v-radio
        v-for="cameraKey in displayKeys"
        :key="cameraKey"
        :value="cameraKey"
        :label="cameraKey"
      />
    </v-radio-group>
    <v-row
      v-if="stereo"
      no-gutters
      class="align-center"
      :class="{ 'mt-2': showDefaultDisplayInfo }"
    >
      <v-text-field
        label="Calibration File:"
        placeholder="Choose File"
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
        Open Calibration File
        <v-icon class="ml-2">
          mdi-matrix
        </v-icon>
      </v-btn>
    </v-row>
  </div>
</template>
