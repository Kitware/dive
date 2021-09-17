<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import {
  useAllTypes,
  useCheckedTypes,
  useHandler,
  useTypeStyling,
} from 'vue-media-annotator/provides';

export default defineComponent({
  setup() {
    const checkedTypesRef = useCheckedTypes();
    const handler = useHandler();
    const allTypesRef = useAllTypes();
    const typeStylingRef = useTypeStyling();

    return {
      handler,
      allTypesRef,
      checkedTypesRef,
      typeStylingRef,
    };
  },
});
</script>

<template>
  <div class="mx-4">
    <div
      v-for="type in checkedTypesRef"
      :key="type"
      class="slidercontainer"
    >
      <span class="text-body-2">{{ type }}</span>
      <input
        type="range"
        min="0"
        max="1"
        value="0.1"
        step="0.05"
        class="slider"
      >
    </div>
  </div>
</template>

<style scoped>
.slider {
  width: 100%; /* Width of the outside container */
}
</style>
