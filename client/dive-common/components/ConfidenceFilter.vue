<script>
import { throttle, debounce } from 'lodash';

export default {
  name: 'ConfidenceFilter',
  props: {
    confidence: {
      type: Number,
      required: true,
    },
  },
  created() {
    this.updateConfidence = throttle(this.updateConfidence, 100);
    this.emitEnd = debounce(this.emitEnd, 200);
  },
  methods: {
    updateConfidence(value) {
      this.$emit('update:confidence', value);
    },
    emitEnd() {
      this.$emit('end');
    },
  },
};
</script>

<template>
  <div>
    <v-slider
      dense
      :min="0"
      :max="1"
      :step="0.01"
      :value="confidence"
      :hint="`Confidence Filter: ${confidence.toFixed(2)}`"
      class="px-3 mb-2"
      persistent-hint
      @input="updateConfidence"
      @end="emitEnd"
      @mouseup="emitEnd"
    />
  </div>
</template>
