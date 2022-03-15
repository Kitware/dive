<script lang="ts">
import { defineComponent, ref } from '@vue/composition-api';

import { useHandler, useImageEnhancements } from 'vue-media-annotator/provides';

export default defineComponent({
  name: 'ImageEnhancements',
  description: 'Image controls',
  setup() {
    const { setSVGFilters } = useHandler();
    const imageEnhancements = useImageEnhancements();
    const range = ref([
      imageEnhancements.value.blackPoint ?? 0,
      imageEnhancements.value.blackPoint ?? 1,
    ]);

    const modifyValue = () => {
      setSVGFilters({ blackPoint: range.value[0], whitePoint: range.value[1] });
    };
    return {
      modifyValue,
      range,
    };
  },
});
</script>

<template>
  <div class="mx-4">
    <span class="text-body-2">
      Controls for adjusting white balance of images.
    </span>
    <v-range-slider
      v-model="range"
      :min="0"
      :max="1"
      :step="0.01"
      thumb-label="always"
      label="Low/High"
      @input="modifyValue"
    />
  </div>
</template>

<style scoped>
</style>
