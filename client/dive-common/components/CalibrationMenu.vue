<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  PropType,
  ref,
  watch,
} from 'vue';

import {
  DatasetCalibrationResult,
  useApi,
} from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

import CalibrationDialog from './CalibrationDialog.vue';

const CONVERSION_POLL_INTERVAL_MS = 3000;

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
  emits: ['calibration-deleted'],
  setup(props, { emit }) {
    const showCalibrationDialog = ref(false);
    const calibrationResult = ref<DatasetCalibrationResult>();
    const { prompt } = usePrompt();

    const {
      getDatasetCalibration, downloadCalibration, deleteCalibration,
    } = useApi();

    const refresh = async () => {
      try {
        const res = await getDatasetCalibration(props.datasetId);
        calibrationResult.value = res ?? undefined;
      } catch (err) {
        console.error('Failed to load calibration:', err);
        await prompt({
          title: 'Calibration Error',
          text: ['Failed to load calibration information.', String(err)],
          confirm: false,
        });
      }
    };
    refresh();
    // The calibration may be imported elsewhere (the Import menu) while this
    // component stays mounted, so re-fetch whenever the dialog is opened and
    // when the dataset changes.
    watch(() => showCalibrationDialog.value, (open) => { if (open) refresh(); });
    watch(() => props.datasetId, () => refresh());
    watch(() => props.calibrationFile, () => refresh());

    const hasCalibration = computed(() => !!calibrationResult.value);

    const conversionPending = computed(() => {
      const result = calibrationResult.value;
      if (!result || result.calibration || result.conversionError) {
        return false;
      }
      return !!(result.itemId || result.originalName || result.jsonPath || result.path);
    });

    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    const startPolling = () => {
      stopPolling();
      if (!conversionPending.value) {
        return;
      }
      pollTimer = setInterval(() => {
        refresh().then(() => {
          if (!conversionPending.value) {
            stopPolling();
          }
        });
      }, CONVERSION_POLL_INTERVAL_MS);
    };

    watch(conversionPending, (pending) => {
      if (pending) {
        startPolling();
      } else {
        stopPolling();
      }
    }, { immediate: true });

    onBeforeUnmount(stopPolling);

    const sourceFileName = computed(
      () => calibrationResult.value?.originalName,
    );
    const jsonFileName = computed(
      () => calibrationResult.value?.jsonPath ?? calibrationResult.value?.path,
    );
    const calibrationFileName = computed(
      () => sourceFileName.value ?? jsonFileName.value,
    );
    const conversionError = computed(
      () => calibrationResult.value?.conversionError,
    );

    const openCalibrationDialog = () => {
      if (hasCalibration.value) {
        showCalibrationDialog.value = true;
      }
    };

    const onDownload = async () => {
      if (!downloadCalibration) {
        return;
      }
      if (!calibrationResult.value?.itemId) {
        await prompt({
          title: 'Download Unavailable',
          text: ['No calibration file is available to download.'],
          confirm: false,
        });
        return;
      }
      try {
        await downloadCalibration(props.datasetId);
      } catch (err) {
        await prompt({
          title: 'Download Failed',
          text: [String(err)],
          confirm: false,
        });
      }
    };

    const onDelete = async () => {
      if (!deleteCalibration) {
        return;
      }
      try {
        await deleteCalibration(props.datasetId);
        calibrationResult.value = undefined;
        showCalibrationDialog.value = false;
        emit('calibration-deleted');
      } catch (err) {
        await prompt({
          title: 'Delete Failed',
          text: [String(err)],
          confirm: false,
        });
      }
    };

    return {
      showCalibrationDialog,
      calibrationResult,
      hasCalibration,
      sourceFileName,
      jsonFileName,
      calibrationFileName,
      conversionError,
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
        <template v-if="conversionError">
          <br>
          Conversion failed
        </template>
      </span>
      <span v-else>
        No calibration file loaded. Use the Import button to import a calibration file.
      </span>
    </v-tooltip>

    <CalibrationDialog
      v-model="showCalibrationDialog"
      :calibration="calibrationResult?.calibration"
      :source-file-name="sourceFileName"
      :json-file-name="jsonFileName"
      :conversion-error="conversionError"
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
