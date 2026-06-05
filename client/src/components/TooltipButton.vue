<script lang="ts">
import { defineComponent, PropType } from 'vue';

export default defineComponent({
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
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        :size="size"
        icon
        :disabled="disabled"
        :color="color"
        :variant="outlined ? 'outlined' : 'flat'"
        :tile="tile"
        class="ma-0"
        @click="$emit('click', $event)"
      >
        <v-icon>
          {{ icon }}
        </v-icon>
      </v-btn>
    </template>
    <span>{{ tooltipText }}</span>
  </v-tooltip>
</template>
