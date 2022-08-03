<script lang="ts">
import Vue, { PropType } from 'vue';

export default Vue.extend({
  name: 'TooltipButton',

  props: {
    icon: {
      type: String as PropType<string>,
      required: true,
    },
    tooltipText: {
      type: String as PropType<string>,
      required: true,
    },
    disabled: {
      type: Boolean as PropType<boolean>,
      default: false,
    },
    color: {
      type: String as PropType<string>,
      default: undefined,
    },
    delay: {
      type: Number,
      default: 600,
    },
    size: {
      type: String,
      default: 'small',
    },
    outlined: {
      type: Boolean,
      default: false,
    },
    tile: {
      type: Boolean,
      default: false,
    },
  },
});
</script>

<template>
  <v-tooltip
    bottom
    :open-delay="delay"
  >
    <template #activator="{ on, attrs }">
      <v-btn
        v-bind="attrs"
        :small="size === 'small'"
        :x-small="size === 'x-small'"
        icon
        :disabled="disabled"
        :color="color"
        :outlined="outlined"
        :tile="tile"
        class="ma-0"
        v-on="on"
        @click="$emit('click')"
      >
        <v-icon>
          {{ icon }}
        </v-icon>
      </v-btn>
    </template>
    <span>{{ tooltipText }}</span>
  </v-tooltip>
</template>
