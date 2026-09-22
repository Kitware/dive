<script lang="ts">
import { defineComponent } from 'vue';
import { calibrationRequiredPipelineMessage } from 'dive-common/pipelineCalibration';

export default defineComponent({
  name: 'PipelineCalibrationWarningIcon',

  props: {
    small: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: true,
    },
  },

  setup() {
    return {
      calibrationRequiredPipelineMessage,
    };
  },
});
</script>

<template>
  <v-tooltip
    top
    :open-delay="250"
    max-width="300"
    content-class="pipeline-calibration-warning-tooltip"
  >
    <template #activator="{ on, attrs }">
      <v-icon
        v-bind="attrs"
        :small="small"
        color="warning"
        class="pipeline-calibration-warning-icon"
        v-on="on"
        @click.stop
      >
        mdi-alert
      </v-icon>
    </template>
    <div class="pipeline-calibration-warning-tooltip__body">
      <v-icon
        small
        class="pipeline-calibration-warning-tooltip__icon"
      >
        mdi-alert
      </v-icon>
      <span>
        <template v-if="disabled">Cannot run: </template>
        {{ calibrationRequiredPipelineMessage }}
      </span>
    </div>
  </v-tooltip>
</template>

<style>
.pipeline-calibration-warning-tooltip.v-tooltip__content {
  background: #fb8c00 !important;
  color: #1a1a1a !important;
  opacity: 1 !important;
  border: 1px solid #e65100;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

.pipeline-calibration-warning-tooltip__body {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-weight: 500;
  line-height: 1.35;
}

.pipeline-calibration-warning-tooltip__icon {
  flex-shrink: 0;
  margin-top: 1px;
  color: #1a1a1a !important;
}
</style>
