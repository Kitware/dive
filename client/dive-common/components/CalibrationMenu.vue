<script lang="ts">
import {
  defineComponent,
  ref,
} from 'vue';

import {
  DatasetCalibrationResult,
  useApi,
} from 'dive-common/apispec';

import { deleteItem, deleteResources, getUri } from 'platform/web-girder/api';

import CalibrationDialog from './CalibrationDialog.vue';

export default defineComponent({
  name: 'CalibrationMenu',
  props: {
    datasetId: { type: String, required: true },
  },
  components: {
    CalibrationDialog,
  },
  setup(props) {
    const showCalibrationDialog = ref(false);
    const calibrationResult = ref<DatasetCalibrationResult>();

    const { getDatasetCalibration } = useApi();

    getDatasetCalibration(props.datasetId).then((res) => {
      console.log("then", res)
      calibrationResult.value = res;
    })

    const downloadCalibration = () => {
      const url = getUri({ url: `file/${calibrationResult.value?.itemId}/download` });
      window.location.assign(url);
    };

    const deleteCalibration = () => {
      console.log("delete");
      console.log(calibrationResult.value);
      if (calibrationResult.value?.itemId) {
        deleteItem(calibrationResult.value.itemId).then(() => {
          console.log("deleted")
          calibrationResult.value = undefined;
        });
      }
    };

    return {
      showCalibrationDialog,
      calibrationResult,
      downloadCalibration,
      deleteCalibration,
    };
  },
});
</script>

<template>
  <div>
    <v-tooltip
      bottom
      :z-index="20">
      <template #activator="{ on }">
      <v-btn
        color=""
        class="calibration-icon mx-1 mode-button"
        :class="{ 'not-calibrated': !calibrationResult }"
        small
        v-on="on"
        @click="showCalibrationDialog = true"
      >
        <v-icon>mdi-checkerboard</v-icon>
      </v-btn>
      </template>
      <span>Cameras calibration</span>
    </v-tooltip>

    <CalibrationDialog
      v-model="showCalibrationDialog"
      :calibration="calibrationResult?.calibration"
      @download="downloadCalibration"
      @delete="deleteCalibration"
    />
  </div>
</template>

<style>
.calibration-icon {
  border-width: 1px;
  padding: 3px;
  font-size: 1.2em !important;
  margin-top: -4px;
}

.not-calibrated {
  border-color: orange !important;
  color: orange !important;
}

.mode-button {
  border: 1px solid grey;
  min-width: 36px;
}
</style>