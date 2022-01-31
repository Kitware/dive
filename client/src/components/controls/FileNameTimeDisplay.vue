<script lang="ts">
import { computed, defineComponent, PropType } from '@vue/composition-api';
import { useSelectedCamera } from '../../provides';
import { MediaControlAggregator } from '../annotators/mediaControllerType';

export default defineComponent({
  name: 'FileNameTimeDisplay',
  props: {
    displayType: {
      type: String as PropType<'filename' |'time'>,
      required: true,
    },
    mediaControls: {
      type: Object as PropType<MediaControlAggregator>,
      required: true,
    },
  },
  setup(props) {
    const {
      currentTime: currentTimes, duration: durations, filename: filenames, frame,
    } = props.mediaControls;
    const selectedCamera = useSelectedCamera();
    const filename = computed(() => filenames.value[selectedCamera.value]);
    const duration = computed(() => durations.value[selectedCamera.value]);
    const currentTime = computed(() => currentTimes.value[selectedCamera.value]);
    const display = computed(() => {
      let value = 'unsupported display';
      if (props.displayType === 'filename') {
        value = filename.value;
      } if (props.displayType === 'time') {
        value = `${new Date(currentTime.value * 1000).toISOString().substr(11, 8)} / ${new Date(duration.value * 1000).toISOString().substr(11, 8)}`;
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
