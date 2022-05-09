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
        small
        icon
        :disabled="disabled"
        :color="color"
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
