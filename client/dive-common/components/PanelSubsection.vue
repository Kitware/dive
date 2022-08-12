<script lang="ts">
import { defineComponent } from '@vue/composition-api';

export default defineComponent({
  setup() {
    return {
    };
  },
});
</script>

<template>
  <span class="d-flex flex-column overflow-hidden panel-subsection">
    <div class="border-highlight">
      <slot name="header" />
    </div>
    <v-row
      dense
      class="scroll-section shrink"
      no-gutters
    >
      <slot name="scroll-section" />
    </v-row>
  </span>
</template>

<style scoped lang="scss">
.panel-subsection {
  min-height: 100px;
}
.border-highlight {
  border-top: 1px solid gray;
  border-bottom: 1px solid gray;
  color: white;
  font-weight: bold;
  font-size: 0.9em;
  padding: 4px 10px;
  background-color: #272727;
}
.scroll-section {
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 40px;
}
</style>
