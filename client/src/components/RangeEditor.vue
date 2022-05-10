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
    frame: {
      type: Number,
      default: 0,
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
            #3a3a3a ${((frame - begin) / (end - begin) * 100).toFixed(0)}%,
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
        min="0"
        :rules="[
          (v) => v <= end || 'Begin must be less than end',
        ]"
        :max="end"
        @input="updateBegin"
      >
        <template
          v-if="!disabled"
          #append-outer
        >
          <tooltip-btn
            icon="mdi-map-marker"
            tooltip-text="Set frame range begin to current frame"
            :delay="300"
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
        :min="begin"
        :rules="[
          (v) => v >= begin || 'End must be greather than begin',
        ]"
        @input="updateEnd"
      >
        <template
          v-if="!disabled"
          #append-outer
        >
          <tooltip-btn
            icon="mdi-map-marker"
            :delay="300"
            tooltip-text="Set frame range end to current frame"
            @click="$emit('click:end')"
          />
        </template>
      </v-text-field>
    </div>
  </div>
</template>
