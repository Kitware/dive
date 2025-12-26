<script lang="ts">
import { computed, defineComponent } from 'vue';
import {
  useDatasetId,
  useTrackFilters,
  useTrackStyleManager,
} from 'vue-media-annotator/provides';
import ConfidenceFilter from 'dive-common/components/ConfidenceFilter.vue';
import { useApi } from 'dive-common/apispec';
import { DefaultConfidence } from 'vue-media-annotator/BaseFilterControls';

export default defineComponent({
  name: 'TypeThreshold',

  components: { ConfidenceFilter },

  setup() {
    const trackFilters = useTrackFilters();
    const datasetIdRef = useDatasetId();
    const { saveMetadata } = useApi();

    function saveThreshold() {
      saveMetadata(datasetIdRef.value, {
        confidenceFilters: trackFilters.confidenceFilters.value,
      });
    }

    function resetThresholds() {
      trackFilters.setConfidenceFilters({ default: DefaultConfidence });
      saveThreshold();
    }

    const showAllAnnotationsRef = computed(() => trackFilters.showAllAnnotations.value);

    return {
      checkedTypesRef: trackFilters.checkedTypes,
      confidenceFiltersRef: trackFilters.confidenceFilters,
      typeStylingRef: useTrackStyleManager().typeStyling,
      showAllAnnotationsRef,
      resetThresholds,
      saveThreshold,
    };
  },
});
</script>

<template>
  <div class="mx-4">
    <span class="text-body-2">
      Any individual type thresholds take effect when they are set higher than the base threshold.
    </span>
    <v-divider class="my-3" />
    <ConfidenceFilter
      :disabled="showAllAnnotationsRef"
      :confidence.sync="confidenceFiltersRef.default"
      text="Base Confidence Threshold"
      @end="saveThreshold"
    />
    <v-divider class="my-3" />
    <div
      v-for="type in checkedTypesRef"
      :key="type"
      class="slidercontainer"
    >
      <ConfidenceFilter
        :disabled="showAllAnnotationsRef"
        :confidence.sync="confidenceFiltersRef[type]"
        :text="type"
        :color="typeStylingRef.color(type)"
        @end="saveThreshold"
      />
    </div>
    <v-btn
      block
      depressed
      class="my-3"
      color="warning"
      @click="resetThresholds"
    >
      Reset Thresholds
    </v-btn>
  </div>
</template>

<style scoped>
.slider {
  width: 100%; /* Width of the outside container */
}
</style>
