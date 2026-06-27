<script lang="ts">
import {
  computed,
  defineComponent,
  PropType,
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
    calibrationFile: {
      type: String as PropType<string | null>,
      default: null,
    },
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
    watch(() => props.calibrationFile, () => refresh());

    const hasCalibration = computed(() => !!calibrationResult.value);

    const calibrationFileName = computed(
      () => calibrationResult.value?.originalName ?? calibrationResult.value?.path,
    );

    const openCalibrationDialog = () => {
      if (hasCalibration.value) {
        showCalibrationDialog.value = true;
      }
    };

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
      hasCalibration,
      calibrationFileName,
      openCalibrationDialog,
      canDownload: !!downloadCalibration,
      canDelete: !!deleteCalibration,
      onDownload,
      onDelete,
    };
  },
});
</script>

<template>
  <div class="calibration-menu-inline">
    <v-tooltip
      bottom
      :z-index="20"
    >
      <template #activator="{ on }">
        <span
          class="calibration-menu-inline__activator"
          v-on="on"
        >
          <v-icon
            class="mx-1"
            :class="{ 'calibration-menu-icon--disabled': !hasCalibration }"
            @click="openCalibrationDialog"
          >
            mdi-checkerboard
          </v-icon>
        </span>
      </template>
      <span v-if="hasCalibration">
        Cameras calibration
        <template v-if="calibrationFileName">
          <br>
          {{ calibrationFileName }}
        </template>
      </span>
      <span v-else>
        No calibration file loaded. Use the Import button to import a calibration file.
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

<style scoped lang="scss">
.calibration-menu-inline__activator {
  display: inline-flex;
  align-items: center;
}

.calibration-menu-icon--disabled {
  opacity: 0.38;
  cursor: default;
}
</style>
