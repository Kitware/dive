<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
  watch,
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
    buttonOptions: { type: Object, default: () => ({}) },
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
    // The calibration may be imported elsewhere (the Import menu) while this
    // component stays mounted, so re-fetch whenever the dialog is opened and
    // when the dataset changes.
    watch(() => showCalibrationDialog.value, (open) => { if (open) refresh(); });
    watch(() => props.datasetId, () => refresh());

    const calibrationFileName = computed(
      () => calibrationResult.value?.originalName ?? calibrationResult.value?.path,
    );

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
          class="ma-0"
          v-bind="buttonOptions"
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
