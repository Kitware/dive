<script lang="ts">
import {
  defineComponent, PropType, ref, watch,
} from 'vue';

type Box = [number, number, number, number];

/**
 * An exemplar image with a box the user drags out on it, reported in image
 * pixels. Dragging again replaces the box; a click clears it.
 */
export default defineComponent({
  name: 'QueryExemplar',
  props: {
    src: {
      type: String,
      required: true,
    },
    box: {
      type: Array as unknown as PropType<Box | null>,
      default: null,
    },
  },
  setup(props, { emit }) {
    const image = ref<HTMLImageElement | null>(null);
    const draft = ref<Box | null>(props.box);
    let start: [number, number] | null = null;

    watch(() => props.box, (next) => { draft.value = next; });

    /** Image pixel under a pointer event, allowing for the displayed scale. */
    function imagePoint(event: PointerEvent): [number, number] | null {
      const el = image.value;
      if (!el || !el.naturalWidth) return null;
      const rect = el.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * el.naturalWidth;
      const y = ((event.clientY - rect.top) / rect.height) * el.naturalHeight;
      return [
        Math.min(el.naturalWidth, Math.max(0, x)),
        Math.min(el.naturalHeight, Math.max(0, y)),
      ];
    }

    function onDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const point = imagePoint(event);
      if (!point) return;
      start = point;
      draft.value = null;
      image.value?.setPointerCapture(event.pointerId);
    }

    function onMove(event: PointerEvent) {
      if (!start) return;
      const point = imagePoint(event);
      if (!point) return;
      draft.value = [
        Math.min(start[0], point[0]), Math.min(start[1], point[1]),
        Math.max(start[0], point[0]), Math.max(start[1], point[1]),
      ];
    }

    function onUp(event: PointerEvent) {
      if (!start) return;
      start = null;
      try {
        image.value?.releasePointerCapture(event.pointerId);
      } catch {
        // Capture may already be gone.
      }
      const box = draft.value;
      // A tiny drag is a click: clear the box.
      if (!box || (box[2] - box[0]) < 4 || (box[3] - box[1]) < 4) {
        draft.value = null;
        emit('update:box', null);
        return;
      }
      emit('update:box', box.map(Math.round) as Box);
    }

    /** The box as a percentage rectangle over the displayed image. */
    function boxStyle(): Record<string, string> {
      const el = image.value;
      const box = draft.value;
      if (!el || !box || !el.naturalWidth) return { display: 'none' };
      return {
        left: `${(100 * box[0]) / el.naturalWidth}%`,
        top: `${(100 * box[1]) / el.naturalHeight}%`,
        width: `${(100 * (box[2] - box[0])) / el.naturalWidth}%`,
        height: `${(100 * (box[3] - box[1])) / el.naturalHeight}%`,
      };
    }

    return {
      image, draft, onDown, onMove, onUp, boxStyle,
    };
  },
});
</script>

<template>
  <div class="query-exemplar">
    <img
      ref="image"
      :src="src"
      class="exemplar-image"
      draggable="false"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
    <div
      class="exemplar-box"
      :style="boxStyle()"
    />
    <div class="text-caption grey--text mt-1">
      {{ draft ? `Box ${draft.map(Math.round).join(', ')} (click to clear)` : 'Whole image; drag to mark one object' }}
    </div>
  </div>
</template>

<style scoped>
.query-exemplar {
  position: relative;
  display: inline-block;
  max-width: 100%;
}

.exemplar-image {
  display: block;
  max-width: 100%;
  max-height: 260px;
  user-select: none;
  touch-action: none;
  cursor: crosshair;
}

.exemplar-box {
  position: absolute;
  border: 2px solid #00e5ff;
  background: rgba(0, 229, 255, 0.12);
  pointer-events: none;
}
</style>
