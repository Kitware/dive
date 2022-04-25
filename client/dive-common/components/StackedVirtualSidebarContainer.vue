<script lang="ts">
import {
  defineComponent,
  reactive,
  toRef,
  watch,
} from '@vue/composition-api';

/* Magic numbers used in height calculations */
const toolbarHeight = 112;
const confidenceThresholdHeight = 52;

export default defineComponent({
  props: {
    width: {
      type: Number,
      default: 300,
    },
    enableSlot: {
      type: Boolean,
      default: false,
    },
  },

  setup(props) {
    const data = reactive({
      topHeight: 0,
      bottomHeight: 0,
    });

    function onResize() {
      const totalHeight = window.innerHeight - toolbarHeight;
      data.topHeight = Math.floor(totalHeight * 0.45);
      data.bottomHeight = Math.floor(totalHeight * 0.55);
      if (props.enableSlot) {
        data.topHeight -= confidenceThresholdHeight;
      }
    }
    onResize();
    watch(toRef(props, 'enableSlot'), onResize);

    return {
      data,
      onResize,
    };
  },
});
</script>

<template>
  <v-card
    v-resize="onResize"
    :width="width"
    tile
    outlined
    class="sidebar d-flex flex-column overflow-hidden"
    style="z-index:1;"
  >
    <slot
      name="default"
      v-bind="data"
    />
  </v-card>
</template>

<style scoped>
.sidebar {
  max-height: calc(100vh - 112px);
}
</style>
