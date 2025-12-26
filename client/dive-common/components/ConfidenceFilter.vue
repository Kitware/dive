<script lang="ts">
import { defineComponent } from 'vue';
import { throttle, debounce } from 'lodash';

export default defineComponent({
  name: 'ConfidenceFilter',
  props: {
    confidence: {
      type: Number,
      default: 0,
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
      default: null,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { emit }) {
    function _updateConfidence(event: InputEvent & {target: {value: string}}) {
      if (event.target) {
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
    <div class="text-body-2 grey--text text--lighten-1 d-flex flex-row py-0">
      <span
        v-if="color"
        :style="{ color }"
        class="pr-1 pb-1"
      >
        █
      </span>
      <span
        :class="{ 'main-confidence': text === 'Confidence Threshold' }"
      >{{ text }}</span>
      <v-spacer v-if="!$scopedSlots.default" />
      <span class="pl-2">
        {{ confidence.toFixed(2) }}
      </span>
      <v-spacer v-if="$scopedSlots.default" />
      <slot />
    </div>
    <input
      type="range"
      style="width: 100%"
      :disabled="disabled"
      :min="min"
      :max="1"
      :step="0.01"
      :value="Math.max(min, confidence)"
      persistent-hint
      @input="updateConfidence"
      @end="emitEnd"
      @mouseup="emitEnd"
    >
  </div>
</template>

<style scoped>
.main-confidence {
  color: white;
  font-weight: bold;
}
</style>
