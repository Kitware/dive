<script lang="ts">
import { computed, defineComponent, PropType } from '@vue/composition-api';
import { useSelectedCamera } from '../../provides';
import { injectAggregateController } from '../annotators/useMediaController';

export default defineComponent({
  name: 'FileNameTimeDisplay',
  props: {
    displayType: {
      type: String as PropType<'filename' |'time'>,
      required: true,
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
    return {
      display,
      frame,
      currentTime,
      selectedCamera,
    };
  },
});
</script>

<template>
  <span>
    <span>
      {{ display }}
    </span>
    <span class="border-radius mr-1">frame {{ frame }}</span>
  </span>
</template>

<style scoped>
.border-radius {
  border: 1px solid #888888;
  padding: 2px 5px;
  border-radius: 5px;
}
</style>
