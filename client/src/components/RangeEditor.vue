<script lang="ts">
import { defineComponent } from 'vue';
import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';

export default defineComponent({
  name: 'RangeEditor',
  components: { TooltipBtn },
  props: {
    begin: {
      type: Number,
      required: true,
    },
    end: {
      type: Number,
      required: true,
    },
    last: {
      type: Boolean,
      default: true,
    },
    frame: {
      type: Number,
      default: 0,
    },
    min: {
      type: Number,
      default: 0,
    },
    max: {
      type: Number,
      default: Infinity,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  setup(_, { emit }) {
    function updateBegin(event: Event) {
      const num = parseInt((event.target as HTMLInputElement).value, 10);
      emit('update:begin', num);
    }
    function updateEnd(event: Event) {
      const num = parseInt((event.target as HTMLInputElement).value, 10);
      emit('update:end', num);
    }
    return {
      updateBegin,
      updateEnd,
    };
  },
});
</script>

<template>
  <div>
    <div
      class="d-flex align-center px-1"
      :style="{
        background: `linear-gradient(
            to right,
            #2c759650 ${((frame - begin) / (end - begin) * 100).toFixed(0)}%,
            rgba(0,0,0,0) ${(1 - ((frame - begin) / (end - begin)) * 100, 0).toFixed(0)}%)`,
      }"
    >
      <div class="d-flex align-center px-2 range-field">
        <input
          :value="begin"
          :disabled="disabled"
          type="number"
          class="input-box range-input"
          :min="min"
          :max="Math.min(end, max)"
          @input="updateBegin"
        >
        <tooltip-btn
          v-if="!disabled"
          icon="mdi-map-marker"
          variant="text"
          :tooltip-text="`Set range start to current frame (${frame})`"
          size="x-small"
          :delay="100"
          :disabled="frame < min || frame > Math.min(end, max)"
          @click="$emit('click:begin')"
        />
      </div>
      <div class="d-flex align-center px-2 range-field">
        <input
          :value="end"
          :disabled="disabled"
          type="number"
          class="input-box range-input"
          :min="Math.max(begin, min)"
          :max="max"
          @input="updateEnd"
        >
        <tooltip-btn
          v-if="!disabled"
          icon="mdi-map-marker"
          variant="text"
          :delay="100"
          size="x-small"
          :tooltip-text="`Set range end to current frame (${frame})`"
          :disabled="frame < Math.max(begin, min) || frame > max"
          @click="$emit('click:end')"
        />
      </div>
      <tooltip-btn
        v-if="!disabled && last"
        icon="mdi-clock-plus"
        variant="text"
        tooltip-text="Add new sub-range"
        :delay="100"
        :disabled="frame < min || frame > max"
        size="x-small"
        @click="$emit('click:add-range')"
      />
      <tooltip-btn
        v-if="!disabled && !last"
        icon="mdi-clock-minus"
        variant="text"
        tooltip-text="Remove sub-range"
        :delay="100"
        size="x-small"
        @click="$emit('click:remove-range')"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import 'src/components/styles/common.scss';

.range-field {
  flex: 1 1 0;
  min-width: 0;
}

.range-input {
  width: 100%;
  min-width: 0;
  background-color: transparent;
}
</style>
