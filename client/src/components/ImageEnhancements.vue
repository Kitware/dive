<script lang="ts">
import {
  computed, defineComponent, ref, watch,
} from 'vue';
import {
  useHandler,
  useImageEnhancements,
  usePercentileHistogram,
  usePercentileHistogramLoading,
  usePercentileStretchSupported,
} from '../provides';
import { computePercentileBoundsFromBins } from '../use/useImageEnhancements';

export default defineComponent({
  name: 'ImageEnhancements',
  description: 'Image controls',
  setup() {
    const { setSVGFilters } = useHandler();
    const imageEnhancements = useImageEnhancements();
    const percentileStretchSupported = usePercentileStretchSupported();
    const percentileHistogram = usePercentileHistogram();
    const percentileHistogramLoading = usePercentileHistogramLoading();
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
        percentileStretch: percentileStretchSupported.value && stretchEnabled.value
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

    function markerX(value: number): number {
      const histogram = percentileHistogram.value;
      if (!histogram) return 0;
      const range = histogram.sourceMax - histogram.sourceMin;
      if (range <= 0) return 0;
      const normalized = (value - histogram.sourceMin) / range;
      return Math.max(0, Math.min(100, normalized * 100));
    }

    function formatBound(value: number): string {
      if (!Number.isFinite(value)) return '-';
      const abs = Math.abs(value);
      if (abs >= 1000) return Math.round(value).toString();
      if (abs >= 100) return value.toFixed(1);
      return value.toFixed(2);
    }

    const hasHistogram = computed(() => (percentileHistogram.value?.bins?.length ?? 0) > 0);
    const histogramPolyline = computed(() => {
      const bins = percentileHistogram.value?.bins ?? [];
      if (!bins.length) return '';
      const maxCount = Math.max(...bins);
      if (maxCount <= 0) return '';
      const maxRoot = Math.sqrt(maxCount);
      return bins.map((count, idx) => {
        const x = bins.length === 1 ? 0 : (idx / (bins.length - 1)) * 100;
        const y = 40 - (Math.sqrt(count) / maxRoot) * 40;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      }).join(' ');
    });
    const percentileMarkerValues = computed(() => {
      const histogram = percentileHistogram.value;
      if (!histogram?.bins?.length) {
        return { lowValue: 0, highValue: 0 };
      }
      return computePercentileBoundsFromBins(
        histogram.bins,
        lowPercentile.value,
        highPercentile.value,
        histogram.sourceMin,
        histogram.sourceMax,
      );
    });
    const lowMarkerX = computed(() => markerX(percentileMarkerValues.value.lowValue));
    const highMarkerX = computed(() => markerX(percentileMarkerValues.value.highValue));
    const histogramMinLabel = computed(() => formatBound(percentileHistogram.value?.sourceMin ?? 0));
    const histogramMaxLabel = computed(() => formatBound(percentileHistogram.value?.sourceMax ?? 0));

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
      percentileStretchSupported,
      percentileHistogramLoading,
      hasHistogram,
      histogramPolyline,
      lowMarkerX,
      highMarkerX,
      histogramMinLabel,
      histogramMaxLabel,
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
    <v-divider
      v-if="percentileStretchSupported"
      class="my-3"
    />
    <template v-if="percentileStretchSupported">
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
      <v-row class="ma-0 mt-1 mb-2">
        <v-col cols="12" class="pa-0">
          <div class="histogram-shell">
            <div v-if="percentileHistogramLoading" class="histogram-status text-caption">
              Loading histogram...
            </div>
            <template v-else-if="hasHistogram">
              <svg viewBox="0 0 100 40" preserveAspectRatio="none" class="histogram-svg">
                <polyline
                  :points="histogramPolyline"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.4"
                  class="histogram-line"
                />
                <line :x1="lowMarkerX" y1="0" :x2="lowMarkerX" y2="40" class="histogram-marker-low" />
                <line :x1="highMarkerX" y1="0" :x2="highMarkerX" y2="40" class="histogram-marker-high" />
              </svg>
              <div class="histogram-bounds text-caption">
                <span>{{ histogramMinLabel }}</span>
                <span>{{ histogramMaxLabel }}</span>
              </div>
            </template>
            <div v-else class="histogram-status text-caption">
              Histogram unavailable for this frame.
            </div>
          </div>
        </v-col>
      </v-row>
      <template v-if="stretchEnabled">
        <v-row class="percentile-slider-row">
          <v-col cols="4">
            <span class="text-caption">Low %</span>
          </v-col>
          <v-col cols="5">
            <v-slider
              v-model="lowPercentile"
              :min="0"
              :max="1"
              :step="0.01"
              hide-details
              class="pa-0 ma-0"
              @input="modifyValue()"
            />
          </v-col>
          <v-col cols="3" class="percentile-value-col">
            <span class="percentile-value">{{ lowPercentile.toFixed(2) }}</span>
          </v-col>
        </v-row>
        <v-row class="percentile-slider-row">
          <v-col cols="4">
            <span class="text-caption">High %</span>
          </v-col>
          <v-col cols="5">
            <v-slider
              v-model="highPercentile"
              :min="99"
              :max="100"
              :step="0.01"
              hide-details
              class="pa-0 ma-0"
              @input="modifyValue()"
            />
          </v-col>
          <v-col cols="3" class="percentile-value-col">
            <span class="percentile-value">{{ highPercentile.toFixed(2) }}</span>
          </v-col>
        </v-row>
      </template>
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
.histogram-shell {
  border: 1px solid rgba(127, 127, 127, 0.45);
  border-radius: 4px;
  padding: 6px 8px 4px;
}

.histogram-svg {
  display: block;
  width: 100%;
  height: 56px;
}

.histogram-line {
  opacity: 0.9;
}

.histogram-marker-low {
  stroke: #ff9800;
  stroke-width: 1;
  stroke-dasharray: 2 2;
}

.histogram-marker-high {
  stroke: #4caf50;
  stroke-width: 1;
  stroke-dasharray: 2 2;
}

.histogram-bounds {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
}

.histogram-status {
  min-height: 48px;
  display: flex;
  align-items: center;
}

.percentile-value-col {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-left: 0;
}

.percentile-value {
  min-width: 3.5rem;
  text-align: right;
  white-space: nowrap;
}
</style>
