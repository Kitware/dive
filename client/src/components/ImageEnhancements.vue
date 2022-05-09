<script lang="ts">
import { defineComponent, ref } from '@vue/composition-api';

import { useHandler, useImageEnhancements } from '../provides';

export default defineComponent({
  name: 'ImageEnhancements',
  description: 'Image controls',
  setup() {
    const { setSVGFilters } = useHandler();
    const imageEnhancements = useImageEnhancements();
    const range = ref([
      (imageEnhancements.value.blackPoint ?? 0) * 255.0,
      (imageEnhancements.value.whitePoint ?? 1) * 255.0,
    ]);

    const modifyValue = () => {
      setSVGFilters({ blackPoint: range.value[0] / 255.0, whitePoint: range.value[1] / 255.0 });
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
      Controls for adjusting images.
    </span>
    <v-divider class="my-3" />
    <v-range-slider
      v-model="range"
      :min="0"
      :max="255"
      :step="1.0"
      thumb-label="always"
      label="Contrast:"
      class="my-4"
      @input="modifyValue"
    />
    <v-btn
      block
      depressed
      color="warning"
      class="my-2"
      @click="range = [0, 255]; modifyValue()"
    >
      Reset
    </v-btn>
  </div>
</template>

<style scoped>
</style>
