<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, ref,
} from 'vue';

/**
 * A fixed rows x columns grid filling whatever space it is given; the
 * cells are slotted in by the page. Reports its cell size so chips can be
 * rendered at a matching resolution.
 */
export default defineComponent({
  name: 'ReviewGrid',
  props: {
    columns: {
      type: Number,
      required: true,
    },
    rows: {
      type: Number,
      required: true,
    },
    gap: {
      type: Number,
      default: 6,
    },
  },
  setup(props, { emit }) {
    const container = ref<HTMLElement | null>(null);
    let observer: ResizeObserver | null = null;

    function measure() {
      const el = container.value;
      if (!el) return;
      const width = (el.clientWidth - props.gap * (props.columns - 1)) / props.columns;
      const height = (el.clientHeight - props.gap * (props.rows - 1)) / props.rows;
      emit('cell-size', { width: Math.max(0, width), height: Math.max(0, height) });
    }

    onMounted(() => {
      measure();
      if (typeof ResizeObserver !== 'undefined' && container.value) {
        observer = new ResizeObserver(() => measure());
        observer.observe(container.value);
      }
    });
    onBeforeUnmount(() => {
      observer?.disconnect();
      observer = null;
    });

    const gridStyle = computed(() => ({
      gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${props.rows}, minmax(0, 1fr))`,
      gap: `${props.gap}px`,
    }));

    return { container, gridStyle, measure };
  },
});
</script>

<template>
  <div
    ref="container"
    class="review-grid"
    :style="gridStyle"
  >
    <slot />
  </div>
</template>

<style scoped>
.review-grid {
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
</style>
