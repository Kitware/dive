<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';
import { useSelectedCamera } from '../../provides';
import { injectAggregateController } from '../annotators/useMediaController';

function formatMediaTime(seconds: number) {
  return new Date(seconds * 1000).toISOString().substr(11, 8);
}

export default defineComponent({
  name: 'FileNameTimeDisplay',
  props: {
    displayType: {
      type: String as PropType<'filename' | 'time'>,
      required: true,
    },
    iconToolbar: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const aggregateControllerRef = injectAggregateController();
    const frame = computed(() => aggregateControllerRef.value.frame.value);
    const maxFrame = computed(() => aggregateControllerRef.value.maxFrame.value);
    const currentTime = computed(() => aggregateControllerRef.value.currentTime.value);
    const selectedCamera = useSelectedCamera();
    const selectedCameraController = computed(() => {
      try {
        return aggregateControllerRef.value.getController(selectedCamera.value);
      } catch {
        return undefined;
      }
    });
    const filename = computed(() => (selectedCameraController.value?.filename.value));
    const duration = computed(() => (selectedCameraController.value?.duration.value));
    const currentTimeText = computed(() => formatMediaTime(currentTime.value));
    const durationText = computed(() => formatMediaTime(duration.value || 0));
    const display = computed(() => {
      if (props.displayType === 'filename') {
        return filename.value || 'uninitialized';
      }
      if (props.displayType === 'time') {
        return `${currentTimeText.value} / ${durationText.value}`;
      }
      return 'unsupported display';
    });
    return {
      display,
      frame,
      maxFrame,
      currentTimeText,
      selectedCamera,
    };
  },
});
</script>

<template>
  <div
    v-if="iconToolbar && displayType === 'time'"
    class="time-icon-toolbar"
  >
    <v-tooltip
      location="bottom"
      open-delay="200"
    >
      <template #activator="{ props: activatorProps }">
        <v-icon
          size="small"
          class="time-icon-toolbar__icon"
          v-bind="activatorProps"
        >
          mdi-timer-outline
        </v-icon>
      </template>
      <div class="time-icon-toolbar__tooltip">
        <div>{{ display }}</div>
        <div>frame {{ frame }} / {{ maxFrame }}</div>
      </div>
    </v-tooltip>
    <span class="time-icon-toolbar__badge">{{ currentTimeText }}</span>
  </div>
  <span v-else>
    <span :class="{ 'time-display-value': displayType === 'time' }">
      {{ display }}
    </span>
    <span class="border-radius mr-1">frame {{ frame }} / {{ maxFrame }}</span>
  </span>
</template>

<style scoped>
.time-display-value {
  padding-right: 12px;
}

.time-icon-toolbar {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  min-width: 0;
}

.time-icon-toolbar__icon {
  display: block;
}

.time-icon-toolbar__badge {
  display: block;
  margin-top: 1px;
  padding: 0 3px;
  border: 1px solid #888888;
  border-radius: 4px;
  font-family: monospace;
  font-size: 8px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
}

.time-icon-toolbar__tooltip {
  font-family: monospace;
  font-size: 12px;
  line-height: 1.4;
}

.border-radius {
  border: 1px solid #888888;
  padding: 2px 5px;
  border-radius: 5px;
}
</style>
