<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'OutlinedLabeledGroup',
});
</script>

<template>
  <fieldset class="outlined-labeled-group">
    <legend class="outlined-labeled-group__legend">
      <slot name="legend" />
    </legend>
    <div class="outlined-labeled-group__content">
      <slot />
    </div>
  </fieldset>
</template>

<style scoped lang="scss">
.outlined-labeled-group {
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 4px;
  margin: -9px 4px 0;
  padding: 2px 6px 4px;
  min-inline-size: min-content;
}

.outlined-labeled-group__legend {
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  line-height: 1.25;
  padding: 0 4px;
  width: auto;
}

.outlined-labeled-group__content {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0;
}
</style>
