<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { injectMediaController } from '../annotators/useMediaController';

export default defineComponent({
  name: 'TimelineWrapper',

  setup() {
    return {
      mediaController: injectMediaController(),
    };
  },
});
</script>

<template>
  <div>
    <slot
      :maxFrame="mediaController.maxFrame.value"
      :frame="mediaController.frame.value"
      :seek="mediaController.seek"
      :time="mediaController.time.value"
      :volume="mediaController.volume.value"
      :setVolume="mediaController.setVolume"
    />
  </div>
</template>
