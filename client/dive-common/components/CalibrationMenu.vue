<script lang="ts">
import {
  defineComponent,
  ref,
} from 'vue';

import {
  useApi,
} from 'dive-common/apispec';

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
    const calibration = ref({});

    const { getDatasetCalibration } = useApi();

    getDatasetCalibration(props.datasetId).then((res) => {
      calibration.value = res;
    })

    return {
      showCalibrationDialog,
      calibration
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
        :class="{ 'not-calibrated': !calibration }"
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
      :calibration="calibration"
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