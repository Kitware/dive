<script lang="ts">
import { computed, defineComponent, PropType } from '@vue/composition-api';
import { injectMediaController } from '../annotators/useMediaController';

export default defineComponent({
  name: 'FileNameTimeDisplay',
  props: {
    displayType: {
      type: String as PropType<'filename' |'time'>,
      required: true,
    },
  },
  setup(props) {
    const {
      currentTime, duration, filename, frame,
    } = injectMediaController();
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
