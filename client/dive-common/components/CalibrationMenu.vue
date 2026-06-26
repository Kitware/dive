<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
} from 'vue';

import {
  DatasetCalibrationResult,
  useApi,
} from 'dive-common/apispec';

import CalibrationDialog from './CalibrationDialog.vue';

export default defineComponent({
  name: 'CalibrationMenu',
  components: {
    CalibrationDialog,
  },
  props: {
    datasetId: { type: String, required: true },
  },
  setup(props) {
    const showCalibrationDialog = ref(false);
    const calibrationResult = ref<DatasetCalibrationResult>();

    const {
      getDatasetCalibration, downloadCalibration, deleteCalibration,
    } = useApi();

    const refresh = () => getDatasetCalibration(props.datasetId).then((res) => {
      calibrationResult.value = res ?? undefined;
    });
    refresh();

    const calibrationFileName = computed(() => calibrationResult.value?.path);

    const onDownload = () => {
      downloadCalibration?.(props.datasetId);
    };

    const onDelete = () => {
      deleteCalibration?.(props.datasetId).then(() => {
        calibrationResult.value = undefined;
      });
    };

    return {
      showCalibrationDialog,
      calibrationResult,
      calibrationFileName,
      canDownload: !!downloadCalibration,
      canDelete: !!deleteCalibration,
      onDownload,
      onDelete,
    };
  },
});
</script>

<template>
  <div>
    <v-tooltip
      bottom
      :z-index="20"
    >
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
      <span>
        Cameras calibration
        <template v-if="calibrationFileName">
          <br>
          {{ calibrationFileName }}
        </template>
      </span>
    </v-tooltip>

    <CalibrationDialog
      v-model="showCalibrationDialog"
      :calibration="calibrationResult?.calibration"
      :file-name="calibrationFileName"
      :show-download="canDownload"
      :show-delete="canDelete"
      @download="onDownload"
      @delete="onDelete"
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
