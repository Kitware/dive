<script lang="ts">
import { computed, defineComponent } from 'vue';
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
  setup(props, { emit }) {
    function updateBegin(input: string) {
      const num = parseInt(input, 10);
      emit('update:begin', num);
    }
    function updateEnd(input: string) {
      const num = parseInt(input, 10);
      emit('update:end', num);
    }
    const beginRules = computed(() => [
      (v: number) => v <= Math.min(props.end, props.max) || 'Begin must be less than end and max',
      (v: number) => v >= props.min || 'Begin must be >= min',
    ]);
    const endRules = computed(() => [
      (v: number) => v >= Math.max(props.begin, props.min) || 'End must be >= begin and min',
      (v: number) => v <= props.max || 'End must be <= max',
    ]);
    return {
      updateBegin,
      updateEnd,
      beginRules,
      endRules,
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
        :rules="beginRules"
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
        :rules="endRules"
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
