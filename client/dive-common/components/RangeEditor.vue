<script lang="ts">
import { defineComponent } from '@vue/composition-api';

export default defineComponent({
  props: {
    begin: {
      type: Number,
      required: true,
    },
    end: {
      type: Number,
      required: true,
    },
  },
});
</script>


<template>
  <div>
    <div class="d-flex align-center px-1">
      <v-icon class="mt-1">
        mdi-map-marker-distance
      </v-icon>
      <v-text-field
        :value="begin"
        single-line
        dense
        disabled
        class="px-2 mt-0"
        type="number"
        label="Begin frame"
        hide-details
        @input="$emit('update:begin', $event)"
      />
      <v-text-field
        :value="end"
        hide-details
        single-line
        dense
        disabled
        class="px-2 mt-0"
        type="number"
        label="End frame"
        @input="$emit('update:end', $event)"
      />
    </div>
  </div>
</template>
