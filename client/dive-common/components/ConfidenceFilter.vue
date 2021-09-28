<script lang="ts">
import { defineComponent } from '@vue/composition-api';
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
    <div class="text-body-2 grey--text text--lighten-1 d-flex flex-row py-0">
      <span
        v-if="color"
        :style="{ color }"
        class="pr-1 pb-1"
      >
        █
      </span>
      <span>{{ text }}</span>
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
