<!--
  Dataset name, default display. Requires `ctx`; reads finalize fields from props.ctx.
-->
<script lang="ts">
import { defineComponent } from 'vue';
import { importMultiCamContextProp } from './importMultiCamContext';

export default defineComponent({
  name: 'ImportMultiCamFinalizeStep',
  props: {
    ...importMultiCamContextProp,
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
    } = props.ctx;
    return {
      datasetName,
      datasetNameRules,
      defaultDisplay,
      displayKeys,
      displayKeysKey,
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
  </div>
</template>
