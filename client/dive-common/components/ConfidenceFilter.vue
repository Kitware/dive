<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { throttle, debounce } from 'lodash';
import { DefaultConfidence } from 'vue-media-annotator/use/useTrackFilters';

export default defineComponent({
  name: 'ConfidenceFilter',
  props: {
    confidence: {
      type: Number,
      default: DefaultConfidence,
    },
    text: {
      type: String,
      default: 'Confidence Threshold',
    },
    min: {
      type: Number,
      default: 0,
    },
    color: {
      type: String,
      default: 'inherit',
    },
  },
  setup(props, { emit }) {
    function _updateConfidence(event: InputEvent) {
      if (event.target) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        emit('update:confidence', Number.parseFloat(event.target.value));
      }
    }
    function _emitEnd() {
      emit('end');
    }
    const updateConfidence = throttle(_updateConfidence, 100);
    const emitEnd = debounce(_emitEnd, 200);
    return { updateConfidence, emitEnd };
  },
});
</script>

<template>
  <div>
    <div class="text-caption d-flex flex-row py-0">
      <span>{{ text }} ({{ confidence }})</span>
      <v-spacer />
      <slot />
    </div>
    <input
      type="range"
      :style="{ width: '100%', backgroundColor: color }"
      :min="min"
      :max="1"
      :step="0.02"
      :value="Math.max(min, confidence)"
      persistent-hint
      @input="updateConfidence"
      @end="emitEnd"
      @mouseup="emitEnd"
    >
  </div>
</template>
