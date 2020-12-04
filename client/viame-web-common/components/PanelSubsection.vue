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
  <span class="d-flex flex-column overflow-hidden">
    <div class="border-highlight">
      <v-row
        class="align-center"
        no-gutters
      >
        <slot name="header" />
      </v-row>
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
.border-highlight {
  border-top: 1px solid gray;
  border-bottom: 1px solid gray;
  color: white;
  font-weight: bold;
  font-size: 0.9em;
  padding: 4px 10px;
  min-height: 40px;
  background-color: #272727;
}
.scroll-section {
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
