<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';
import { useSelectedCamera } from '../../provides';
import { injectAggregateController } from '../annotators/useMediaController';

export default defineComponent({
  name: 'FileNameTimeDisplay',
  props: {
    displayType: {
      type: String as PropType<'filename' | 'time'>,
      required: true,
    },
    truncateFilename: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const mediaController = injectAggregateController();
    const { currentTime, frame } = mediaController.value;
    const selectedCamera = useSelectedCamera();
    const selectedCameraController = computed(() => {
      try {
        return mediaController.value.getController(selectedCamera.value);
      } catch {
        return undefined;
      }
    });
    const filename = computed(() => (selectedCameraController.value?.filename.value));
    const duration = computed(() => (selectedCameraController.value?.duration.value));
    const display = computed(() => {
      let value = 'unsupported display';
      if (props.displayType === 'filename') {
        value = filename.value || 'uninitialized';
      } if (props.displayType === 'time') {
        value = `${new Date(currentTime.value * 1000).toISOString().substr(11, 8)} / ${new Date((duration.value || 0) * 1000).toISOString().substr(11, 8)}`;
      }
      return value;
    });
    const showFilenameTooltip = computed(
      () => props.truncateFilename && props.displayType === 'filename',
    );
    return {
      display,
      frame,
      currentTime,
      selectedCamera,
      showFilenameTooltip,
    };
  },
});
</script>

<template>
  <span
    class="filename-time-display"
    :class="{ 'filename-time-display--truncate': truncateFilename }"
  >
    <span
      v-if="showFilenameTooltip"
      class="filename-text-wrap"
    >
      <v-tooltip
        bottom
        open-delay="300"
        :z-index="999"
      >
        <template #activator="{ on, attrs }">
          <span
            class="filename-text"
            v-bind="attrs"
            v-on="on"
          >{{ display }}</span>
        </template>
        <span>{{ display }}</span>
      </v-tooltip>
    </span>
    <span
      v-else
      class="display-text"
    >{{ display }}</span>
    <span class="border-radius mr-1">frame {{ frame }}</span>
  </span>
</template>

<style scoped>
.filename-time-display {
  vertical-align: baseline;
  font-family: monospace;
  font-size: 11px;
  font-weight: bold;
  white-space: nowrap;
}

.filename-time-display--truncate {
  display: flex;
  align-items: baseline;
  min-width: 0;
  max-width: 100%;
  flex: 1 1 auto;
}

.filename-text-wrap {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

.filename-text-wrap ::v-deep .v-tooltip {
  display: block;
  min-width: 0;
}

.filename-text,
.display-text {
  vertical-align: baseline;
}

.filename-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  min-width: 0;
}

.border-radius {
  border: 1px solid #888888;
  padding: 2px 5px;
  border-radius: 5px;
  margin-left: 4px;
}
</style>
