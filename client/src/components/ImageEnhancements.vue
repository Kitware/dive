<script lang="ts">
import { defineComponent, ref } from 'vue';
import { useHandler, useImageEnhancements } from '../provides';

export default defineComponent({
  name: 'ImageEnhancements',
  description: 'Image controls',
  setup() {
    const { setSVGFilters } = useHandler();
    const imageEnhancements = useImageEnhancements();
    const brightness = ref(imageEnhancements.value.brightness || 1);
    const contrast = ref(imageEnhancements.value.contrast || 1);
    const saturation = ref(imageEnhancements.value.saturation || 1);
    const sharpen = ref(imageEnhancements.value.sharpen || 0);

    const modifyValue = () => {
      setSVGFilters({
        brightness: brightness.value,
        contrast: contrast.value,
        saturation: saturation.value,
        sharpen: sharpen.value,
      });
    };

    const reset = () => {
      brightness.value = 1;
      contrast.value = 1;
      saturation.value = 1;
      sharpen.value = 0;
      modifyValue();
    };

    return {
      modifyValue,
      reset,
      brightness,
      contrast,
      saturation,
      sharpen,
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
    <v-row>
      <v-col cols="4">
        <span class="text-caption">Brightness</span>
      </v-col>
      <v-col>
        <v-slider
          v-model="brightness"
          :min="0"
          :max="3"
          :step="0.1"
          hide-details
          class="pa-0 ma-0"
          @input="modifyValue()"
        />
      </v-col>
      <v-col cols="2">
        <span>{{ brightness.toFixed(1) }}</span>
      </v-col>
    </v-row>
    <v-row>
      <v-col cols="4">
        <span class="text-caption">Contrast</span>
      </v-col>
      <v-col>
        <v-slider
          v-model="contrast"
          :min="0"
          :max="3"
          :step="0.1"
          hide-details
          class="pa-0 ma-0"
          @input="modifyValue()"
        />
      </v-col>
      <v-col cols="2">
        <span>{{ contrast.toFixed(1) }}</span>
      </v-col>
    </v-row>
    <v-row>
      <v-col cols="4">
        <span class="text-caption">Saturation</span>
      </v-col>
      <v-col>
        <v-slider
          v-model="saturation"
          :min="0"
          :max="3"
          :step="0.1"
          hide-details
          class="pa-0 ma-0"
          @input="modifyValue()"
        />
      </v-col>
      <v-col cols="2">
        <span>{{ saturation.toFixed(1) }}</span>
      </v-col>
    </v-row>
    <v-row>
      <v-col cols="4">
        <span class="text-caption">Sharpness</span>
      </v-col>
      <v-col>
        <v-slider
          v-model="sharpen"
          :min="0"
          :max="4"
          :step="0.1"
          hide-details
          class="pa-0 ma-0"
          @input="modifyValue()"
        />
      </v-col>
      <v-col cols="2">
        <span>{{ sharpen.toFixed(1) }}</span>
      </v-col>
    </v-row>
    <v-btn
      block
      depressed
      color="warning"
      class="my-2"
      @click="reset()"
    >
      Reset
    </v-btn>
  </div>
</template>

<style scoped>
</style>
