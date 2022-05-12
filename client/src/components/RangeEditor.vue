<script lang="ts">
import { defineComponent } from '@vue/composition-api';
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
    function updateBegin(input: string) {
      const num = parseInt(input, 10);
      emit('update:begin', num);
    }
    function updateEnd(input: string) {
      const num = parseInt(input, 10);
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
      <v-text-field
        :value="begin"
        :disabled="disabled"
        single-line
        dense
        class="px-2 mt-0"
        style="width: 100%"
        type="number"
        label="Begin frame"
        hide-details
        :min="min"
        :max="Math.min(end, max)"
        :rules="[
          (v) => v <= Math.min(end, max) || 'Begin must be less than end and max',
          (v) => v >= min || 'Begin must be >= min',
        ]"
        @input="updateBegin"
      >
        <template
          v-if="!disabled"
          #append-outer
        >
          <tooltip-btn
            icon="mdi-map-marker"
            :tooltip-text="`Set range start to current frame (${frame})`"
            size="x-small"
            :delay="100"
            :disabled="frame < min || frame > Math.min(end, max)"
            @click="$emit('click:begin')"
          />
        </template>
      </v-text-field>
      <v-text-field
        :value="end"
        :disabled="disabled"
        hide-details
        single-line
        dense
        class="px-2 mt-0"
        style="width: 100%"
        type="number"
        label="End frame"
        :min="Math.max(begin, min)"
        :max="max"
        :rules="[
          (v) => v >= Math.max(begin, min) || 'End must be >= begin and min',
          (v) => v <= max || 'End must be <= max',
        ]"
        @input="updateEnd"
      >
        <template
          v-if="!disabled"
          #append-outer
        >
          <tooltip-btn
            icon="mdi-map-marker"
            :delay="100"
            size="x-small"
            :tooltip-text="`Set range end to current frame (${frame})`"
            :disabled="frame < Math.max(begin, min) || frame > max"
            @click="$emit('click:end')"
          />
        </template>
      </v-text-field>
      <tooltip-btn
        v-if="!disabled && last"
        icon="mdi-clock-plus"
        tooltip-text="Add new sub-range"
        :delay="100"
        :disabled="frame < min || frame > max"
        size="x-small"
        @click="$emit('click:add-range')"
      />
      <tooltip-btn
        v-if="!disabled && !last"
        icon="mdi-clock-minus"
        tooltip-text="Remove sub-range"
        :delay="100"
        size="x-small"
        @click="$emit('click:remove-range')"
      />
    </div>
  </div>
</template>
