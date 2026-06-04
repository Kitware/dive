<script lang="ts">
import { defineComponent, ref, watch } from 'vue';
import { useHandler, useImageEnhancements } from '../provides';

export default defineComponent({
  name: 'ImageEnhancements',
  description: 'Image controls',
  setup() {
    const { setSVGFilters } = useHandler();
    const imageEnhancements = useImageEnhancements();
    const brightness = ref(imageEnhancements.value.brightness);
    const contrast = ref(imageEnhancements.value.contrast);
    const saturation = ref(imageEnhancements.value.saturation);
    const sharpen = ref(imageEnhancements.value.sharpen);
    const stretchEnabled = ref(imageEnhancements.value.percentileStretch != null);
    const lowPercentile = ref(imageEnhancements.value.percentileStretch?.lowPercentile ?? 1);
    const highPercentile = ref(imageEnhancements.value.percentileStretch?.highPercentile ?? 99);

    watch(imageEnhancements, (val) => {
      brightness.value = val.brightness;
      contrast.value = val.contrast;
      saturation.value = val.saturation;
      sharpen.value = val.sharpen;
      stretchEnabled.value = val.percentileStretch != null;
      lowPercentile.value = val.percentileStretch?.lowPercentile ?? 1;
      highPercentile.value = val.percentileStretch?.highPercentile ?? 99;
    }, { deep: true });

    const modifyValue = () => {
      setSVGFilters({
        brightness: brightness.value,
        contrast: contrast.value,
        saturation: saturation.value,
        sharpen: sharpen.value,
        percentileStretch: stretchEnabled.value
          ? { lowPercentile: lowPercentile.value, highPercentile: highPercentile.value }
          : null,
      });
    };

    const reset = () => {
      brightness.value = 1;
      contrast.value = 1;
      saturation.value = 1;
      sharpen.value = 0;
      stretchEnabled.value = false;
      lowPercentile.value = 1;
      highPercentile.value = 99;
      modifyValue();
    };

    return {
      modifyValue,
      reset,
      brightness,
      contrast,
      saturation,
      sharpen,
      stretchEnabled,
      lowPercentile,
      highPercentile,
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
    <v-divider class="my-3" />
    <v-row
      align="center"
      class="ma-0"
    >
      <v-col cols="8">
        <span class="text-caption">Percentile Stretch</span>
      </v-col>
      <v-col class="pa-0">
        <v-switch
          v-model="stretchEnabled"
          hide-details
          class="ma-0 pa-0 mt-1"
          @change="modifyValue()"
        />
      </v-col>
    </v-row>
    <template v-if="stretchEnabled">
      <v-row>
        <v-col cols="4">
          <span class="text-caption">Low %</span>
        </v-col>
        <v-col>
          <v-slider
            v-model="lowPercentile"
            :min="0"
            :max="highPercentile - 1"
            :step="1"
            hide-details
            class="pa-0 ma-0"
            @input="modifyValue()"
          />
        </v-col>
        <v-col cols="2">
          <span>{{ lowPercentile }}</span>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="4">
          <span class="text-caption">High %</span>
        </v-col>
        <v-col>
          <v-slider
            v-model="highPercentile"
            :min="lowPercentile + 1"
            :max="100"
            :step="1"
            hide-details
            class="pa-0 ma-0"
            @input="modifyValue()"
          />
        </v-col>
        <v-col cols="2">
          <span>{{ highPercentile }}</span>
        </v-col>
      </v-row>
    </template>
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
