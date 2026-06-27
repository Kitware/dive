<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'ToolbarExpandToggle',
  props: {
    expanded: {
      type: Boolean,
      required: true,
    },
  },
});
</script>

<template>
  <v-tooltip
    bottom
    :open-delay="200"
  >
    <template #activator="{ on: tooltipOn, attrs: tooltipAttrs }">
      <v-btn
        icon
        x-small
        class="expand-toggle ml-1"
        v-bind="tooltipAttrs"
        v-on="tooltipOn"
        @click.stop="$emit('click', $event)"
      >
        <v-icon small>
          {{ expanded ? 'mdi-chevron-left' : 'mdi-chevron-right' }}
        </v-icon>
      </v-btn>
    </template>
    <span>{{ expanded ? 'Collapse' : 'Expand' }}</span>
  </v-tooltip>
</template>

<style scoped>
.expand-toggle {
  opacity: 0.5;
  transition: opacity 0.15s, background-color 0.15s;
}
.expand-toggle:hover {
  opacity: 1;
  background-color: rgba(255, 255, 255, 0.12) !important;
}
</style>
