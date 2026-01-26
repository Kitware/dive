<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
} from 'vue';

export default defineComponent({
  name: 'FrameScrubber',
  props: {
    maxFrame: {
      type: Number,
      default: 0,
    },
    frame: {
      type: Number,
      default: 0,
    },
  },
  emits: ['seek'],
  setup(props, { emit }) {
    const scrubberEl = ref<HTMLElement | null>(null);
    const dragging = ref(false);
    const clientWidth = ref(0);
    const resizeObserver = ref<ResizeObserver | null>(null);

    const handLeftPercent = computed(() => {
      if (props.maxFrame === 0) return 0;
      return (props.frame / props.maxFrame) * 100;
    });

    function updateWidth() {
      if (scrubberEl.value) {
        clientWidth.value = scrubberEl.value.clientWidth;
      }
    }

    function calculateFrame(clientX: number): number {
      if (!scrubberEl.value || props.maxFrame === 0) return 0;
      const rect = scrubberEl.value.getBoundingClientRect();
      const x = clientX - rect.left;
      const percent = Math.max(0, Math.min(1, x / rect.width));
      return Math.round(percent * props.maxFrame);
    }

    function handleMousedown(e: MouseEvent) {
      dragging.value = true;
      const frame = calculateFrame(e.clientX);
      emit('seek', frame);
    }

    function handleMousemove(e: MouseEvent) {
      if (!dragging.value) return;
      const frame = calculateFrame(e.clientX);
      emit('seek', frame);
    }

    function handleMouseup() {
      dragging.value = false;
    }

    function handleMouseleave() {
      dragging.value = false;
    }

    onMounted(() => {
      updateWidth();
      if (scrubberEl.value) {
        resizeObserver.value = new ResizeObserver(updateWidth);
        resizeObserver.value.observe(scrubberEl.value);
      }
      document.addEventListener('mouseup', handleMouseup);
    });

    onBeforeUnmount(() => {
      if (resizeObserver.value && scrubberEl.value) {
        resizeObserver.value.unobserve(scrubberEl.value);
        resizeObserver.value.disconnect();
      }
      document.removeEventListener('mouseup', handleMouseup);
    });

    return {
      scrubberEl,
      handLeftPercent,
      handleMousedown,
      handleMousemove,
      handleMouseleave,
    };
  },
});
</script>

<template>
  <div
    ref="scrubberEl"
    class="frame-scrubber"
    @mousedown="handleMousedown"
    @mousemove="handleMousemove"
    @mouseleave="handleMouseleave"
  >
    <div class="scrubber-track">
      <div
        class="scrubber-fill"
        :style="{ width: `${handLeftPercent}%` }"
      />
      <div
        class="scrubber-hand"
        :style="{ left: `${handLeftPercent}%` }"
      />
    </div>
    <div class="frame-labels">
      <span
        class="frame-label start clickable"
        @mousedown.stop="$emit('seek', 0)"
      >0</span>
      <span class="frame-label current">{{ frame }}</span>
      <span
        class="frame-label end clickable"
        @mousedown.stop="$emit('seek', maxFrame)"
      >{{ maxFrame }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.frame-scrubber {
  width: 100%;
  height: 36px;
  background-color: #1e1e1e;
  border-bottom: 1px solid #444;
  cursor: pointer;
  user-select: none;
  padding: 6px 15px;
  flex-shrink: 0;
}

.scrubber-track {
  position: relative;
  height: 12px;
  background-color: #333;
  border-radius: 3px;
}

.scrubber-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background-color: #80c6e8;
  border-radius: 3px 0 0 3px;
}

.scrubber-hand {
  position: absolute;
  top: -3px;
  width: 4px;
  height: 18px;
  background-color: #299be3;
  transform: translateX(-50%);
  border-radius: 2px;
  box-shadow: 0 0 4px rgba(41, 155, 227, 0.5);
}

.frame-labels {
  position: relative;
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  font-size: 11px;
  color: #888;
}

.frame-label {
  &.current {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    color: #fff;
    font-weight: bold;
  }

  &.clickable {
    cursor: pointer;
    padding: 2px 4px;
    margin: -2px -4px;
    border-radius: 2px;

    &:hover {
      color: #fff;
      background-color: rgba(41, 155, 227, 0.3);
    }
  }
}
</style>
