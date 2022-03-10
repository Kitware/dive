<script lang="ts">
import { defineComponent, ref } from '@vue/composition-api';

import { useApi } from 'dive-common/apispec';
import { useHandler, useSVGFilters } from 'vue-media-annotator/provides';

export default defineComponent({
  name: 'ImageEnhancements',
  description: 'Image controls',
  setup() {
    const filterData = useSVGFilters();
    const { setSVGFilters } = useHandler();
    const range = ref([0, 1]);
    const level = ref(1);

    const modifyValue = () => {
      const slope = level.value / (range.value[1] - range.value[0]);
      const intercept = -(level.value * range.value[0]) / (range.value[1] - range.value[0]);
      setSVGFilters({ brightness: slope, intercept });
    };
    return {
      modifyValue,
      range,
      level,
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
      @change="modifyValue"
    />
    <v-slider
      v-model="level"
      :min="-10"
      :max="10"
      :step="0.01"
      thumb-label="always"
      label="Level"
      @change="modifyValue"
    />
  </div>
</template>

<style scoped>
</style>
