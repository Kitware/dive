<script lang="ts">
import { throttle } from 'lodash';
import * as d3 from 'd3';
import {
  ref, computed, watch, onMounted, onBeforeUnmount, defineComponent, PropType,
} from 'vue';
import { DatasetType } from 'dive-common/apispec';
import { frameToTimestamp } from 'vue-media-annotator/utils';
import { useTrackFilters, useTime } from '../../provides';

type TimeFilterType = 'start' | 'end' | null;

export default defineComponent({
  name: 'Timeline',
  props: {
    maxFrame: {
      type: Number,
      default: 0,
    },
    frame: {
      type: Number,
      default: 0,
    },
    display: {
      type: Boolean,
      default: true,
    },
    datasetType: {
      type: String as PropType<DatasetType>,
      required: true,
    },
  },
  emits: ['seek'],
  setup(props, { emit }) {
    const trackFilters = useTrackFilters();
    const { frameRate } = useTime();

    const init = ref(!!props.maxFrame || 1);
    const mounted = ref(false);
    const startFrame = ref(0);
    const endFrame = ref(props.maxFrame);
    const timelineScale = ref<d3.ScaleLinear<number, number> | null>(null);
    const clientWidth = ref(0);
    const clientHeight = ref(0);
    const margin = ref(20);
    const resizeObserver = ref<ResizeObserver | null>(null);
    const draggingTimeFilter = ref<TimeFilterType>(null);
    const dragTooltipFrame = ref<number | null>(null);
    const dragTooltipPosition = ref<number | null>(null);
    const dragging = ref(false);
    const minimapDragging = ref(false);
    const minimapDraggingStartClientX = ref(0);
    const minimapDraggingStartFrame = ref(0);
    const minimapDraggingEndFrame = ref(0);
    const resizeTimer = ref<ReturnType<typeof setTimeout> | null>(null);

    // Template refs
    const workarea = ref<HTMLElement | null>(null);
    const hand = ref<HTMLElement | null>(null);
    const timeFilterStartLine = ref<HTMLElement | null>(null);
    const timeFilterEndLine = ref<HTMLElement | null>(null);
    const minimap = ref<HTMLElement | null>(null);
    const timelineEl = ref<HTMLElement | null>(null);

    // D3 elements
    let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
    let g: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
    let axis: d3.Axis<d3.NumberValue> | null = null;

    const minimapFillStyle = computed(() => ({
      left: `${(startFrame.value / (props.maxFrame || 1)) * 100}%`,
      width: `${(((endFrame.value || 1) - startFrame.value) / (props.maxFrame || 1)) * 100}%`,
    }));

    const handLeftPosition = computed(() => {
      if (
        !mounted.value
        || props.frame < startFrame.value
        || props.frame > endFrame.value
      ) {
        return null;
      }
      if (endFrame.value === 0) {
        return Math.round(
          margin.value + (clientWidth.value - margin.value) * 0.5,
        );
      }
      return Math.round(
        margin.value + (clientWidth.value - margin.value)
          * ((props.frame - startFrame.value) / ((endFrame.value || 1) - startFrame.value)),
      );
    });

    const timeFilterActive = computed(() => trackFilters && trackFilters.timeFilters.value !== null
      && Array.isArray(trackFilters.timeFilters.value));

    const timeFilterStartFrame = computed(() => {
      if (!timeFilterActive.value || !trackFilters.timeFilters.value) return null;
      return trackFilters.timeFilters.value[0];
    });

    const timeFilterEndFrame = computed(() => {
      if (!timeFilterActive.value || !trackFilters.timeFilters.value) return null;
      return trackFilters.timeFilters.value[1];
    });

    const timeFilterStartPosition = computed(() => {
      if (!timeFilterActive.value || !mounted.value || !timelineScale.value || endFrame.value === startFrame.value) {
        return null;
      }
      const filterStart = timeFilterStartFrame.value;
      if (filterStart === null) return null;
      // Only show line if filter start is within visible range
      if (filterStart < startFrame.value || filterStart > endFrame.value) {
        return null;
      }
      // Calculate position manually using the same formula as timelineScale
      // This ensures reactivity when startFrame/endFrame change
      const position = margin.value + (clientWidth.value - margin.value)
        * ((filterStart - startFrame.value) / (endFrame.value - startFrame.value));
      return Math.round(position);
    });

    const timeFilterEndPosition = computed(() => {
      if (!timeFilterActive.value || !mounted.value || !timelineScale.value || endFrame.value === startFrame.value) {
        return null;
      }
      const filterEnd = timeFilterEndFrame.value;
      if (filterEnd === null) return null;
      // Only show line if filter end is within visible range
      if (filterEnd < startFrame.value || filterEnd > endFrame.value) {
        return null;
      }
      // Calculate position manually using the same formula as timelineScale
      // This ensures reactivity when startFrame/endFrame change
      const position = margin.value + (clientWidth.value - margin.value)
        * ((filterEnd - startFrame.value) / (endFrame.value - startFrame.value));
      return Math.round(position);
    });

    const timeFilterLeftDimmingStyle = computed(() => {
      if (!timeFilterActive.value || !mounted.value || endFrame.value === startFrame.value) {
        return { display: 'none' };
      }
      const startPos = timeFilterStartPosition.value;
      const filterStart = timeFilterStartFrame.value;

      if (filterStart === null) return { display: 'none' };

      // If filter start is before or at visible range start, dim entire left side
      if (filterStart <= startFrame.value) {
        return {
          left: '0px',
          width: `${margin.value}px`,
        };
      }

      // If filter start is within visible range, dim from left edge to start position
      if (startPos !== null && filterStart > startFrame.value) {
        return {
          left: '0px',
          width: `${startPos}px`,
        };
      }

      return { display: 'none' };
    });

    const timeFilterRightDimmingStyle = computed(() => {
      if (!timeFilterActive.value || !mounted.value || endFrame.value === startFrame.value) {
        return { display: 'none' };
      }
      const endPos = timeFilterEndPosition.value;
      const filterEnd = timeFilterEndFrame.value;

      if (filterEnd === null) return { display: 'none' };

      // If filter end is after or at visible range end, dim entire right side
      if (filterEnd >= endFrame.value) {
        return {
          left: `${clientWidth.value}px`,
          right: '0px',
        };
      }

      // If filter end is within visible range, dim from end position to right edge
      if (endPos !== null && filterEnd < endFrame.value) {
        return {
          left: `${endPos}px`,
          right: '0px',
        };
      }

      return { display: 'none' };
    });

    const isVideo = computed(() => props.datasetType === 'video');

    const dragTooltipText = computed(() => {
      if (dragTooltipFrame.value === null) {
        return '';
      }
      let text = `Frame: ${dragTooltipFrame.value}`;
      if (isVideo.value && frameRate.value) {
        const seconds = dragTooltipFrame.value / frameRate.value;
        const timeStr = new Date(seconds * 1000).toISOString().substr(11, 8);
        text += ` (${timeStr})`;
      }
      return text;
    });

    function initD3Timeline() {
      if (!workarea.value) {
        return;
      }
      const width = workarea.value.clientWidth || 0;
      const height = workarea.value.clientHeight || 0;
      if (workarea.value) {
        resizeObserver.value = new ResizeObserver(() => {
          resizeHandler();
        });
        resizeObserver.value.observe(workarea.value);
      }
      // clientWidth and clientHeight are properties used to resize child elements
      clientWidth.value = width - margin.value;
      // Timeline height needs to offset so it doesn't overlap the frame number
      clientHeight.value = height - 15;
      const scale = d3
        .scaleLinear()
        .domain([0, props.maxFrame])
        .range([margin.value, clientWidth.value]);
      timelineScale.value = scale;
      const axisInstance = d3
        .axisTop<number>(scale)
        .tickSize(height - 30)
        .tickSizeOuter(0);
      axis = axisInstance as d3.Axis<d3.NumberValue>;
      if (!svg) {
        svg = d3
          .select(workarea.value)
          .append('svg');
      }
      svg.style('display', 'block')
        .attr('width', clientWidth.value)
        .attr('height', height);
      if (!g) {
        g = svg.append('g')
          .attr('transform', `translate(0,${height - 15})`);
      }

      updateAxis();
      mounted.value = true;
    }

    function resizeHandler() {
      // Debounces resize to prevent it from be calling continuously.
      if (resizeTimer.value) {
        clearTimeout(resizeTimer.value);
      }
      resizeTimer.value = setTimeout(initD3Timeline, 200);
    }

    function onwheel(e: WheelEvent) {
      const extend = Math.round((endFrame.value - startFrame.value) * 0.2)
        * Math.sign(e.deltaY);
      const timelineRect = timelineEl.value?.getBoundingClientRect();
      const xRelativeToTimeline = timelineRect ? e.clientX - timelineRect.left : 0;
      const ratio = (xRelativeToTimeline - margin.value) / clientWidth.value;
      let newStartFrame = startFrame.value - extend * ratio;
      let newEndFrame = endFrame.value + extend * (1 - ratio);
      newStartFrame = Math.max(0, newStartFrame);
      newEndFrame = Math.min(props.maxFrame, newEndFrame);
      if (newStartFrame >= newEndFrame - 10) {
        return;
      }
      startFrame.value = newStartFrame;
      endFrame.value = newEndFrame;
    }

    function updateAxis() {
      if (g && axis) {
        g.call(axis).call((gSelection) => gSelection
          .selectAll('.tick text')
          .attr('y', 0)
          .attr('dy', 13));
      }
    }

    const updateFn = () => {
      if (timelineScale.value) {
        timelineScale.value.domain([startFrame.value, endFrame.value]);
        if (axis) {
          axis.scale(timelineScale.value as d3.AxisScale<d3.NumberValue>);
        }
        updateAxis();
      }
    };

    const update = throttle(updateFn, 30);

    function emitSeek(e: MouseEvent) {
      if (!workarea.value) return;
      const leftBounds = (workarea.value.getBoundingClientRect().left + margin.value);
      const rightBounds = (workarea.value.getBoundingClientRect().right - margin.value);
      if (e.clientX > leftBounds && e.clientX < rightBounds) {
        const frame = Math.round(
          ((e.clientX - leftBounds)
          / (clientWidth.value - margin.value))
          * (endFrame.value - startFrame.value)
          + startFrame.value,
        );
        emit('seek', frame);
      }
    }

    function workareaMouseup(e: MouseEvent) {
      if (draggingTimeFilter.value) {
        draggingTimeFilter.value = null;
        dragTooltipFrame.value = null;
        dragTooltipPosition.value = null;
        return;
      }
      if (dragging.value) {
        emitSeek(e);
      }
      dragging.value = false;
    }

    function workareaMousedown() {
      dragging.value = true;
    }

    function workareaMousemove(e: MouseEvent) {
      if (draggingTimeFilter.value) {
        timeFilterLineMousemove(e);
        return;
      }
      if (dragging.value) {
        emitSeek(e);
      }
      e.preventDefault();
    }

    function workareaMouseleave() {
      dragging.value = false;
    }

    function minimapFillMousedown(e: MouseEvent) {
      e.preventDefault();
      minimapDragging.value = true;
      minimapDraggingStartClientX.value = e.clientX;
      minimapDraggingStartFrame.value = startFrame.value;
      minimapDraggingEndFrame.value = endFrame.value;
    }

    function containerMousemove(e: MouseEvent) {
      e.preventDefault();
      if (draggingTimeFilter.value) {
        timeFilterLineMousemove(e);
        return;
      }
      if (!minimapDragging.value) {
        return;
      }
      if (!e.which) {
        minimapDragging.value = false;
        return;
      }
      const delta = minimapDraggingStartClientX.value - e.clientX;
      const frameDelta = (delta / clientWidth.value) * props.maxFrame;
      const newStartFrame = minimapDraggingStartFrame.value - frameDelta;
      if (newStartFrame < 0) {
        return;
      }
      const newEndFrame = minimapDraggingEndFrame.value - frameDelta;
      if (newEndFrame > props.maxFrame) {
        return;
      }
      startFrame.value = newStartFrame;
      endFrame.value = newEndFrame;
    }

    function containerMouseup() {
      minimapDragging.value = false;
      if (draggingTimeFilter.value) {
        draggingTimeFilter.value = null;
        dragTooltipFrame.value = null;
        dragTooltipPosition.value = null;
      }
    }

    function timeFilterLineMousedown(e: MouseEvent, type: 'start' | 'end') {
      e.preventDefault();
      e.stopPropagation();
      draggingTimeFilter.value = type;
      dragging.value = false; // Prevent normal timeline dragging
    }

    function timeFilterLineMousemove(e: MouseEvent) {
      if (!draggingTimeFilter.value || !mounted.value || !timelineScale.value) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      if (!workarea.value) {
        return;
      }

      const workareaRect = workarea.value.getBoundingClientRect();
      const leftBounds = workareaRect.left + margin.value;
      const rightBounds = workareaRect.right - margin.value;

      // Clamp mouse X to bounds
      const clampedX = Math.max(leftBounds, Math.min(e.clientX, rightBounds));

      // Calculate frame from mouse position
      const frame = Math.round(
        ((clampedX - leftBounds)
        / (clientWidth.value - margin.value))
        * (endFrame.value - startFrame.value)
        + startFrame.value,
      );

      // Clamp to valid range
      const clampedFrame = Math.max(0, Math.min(frame, props.maxFrame));

      // Update tooltip position (relative to workarea)
      dragTooltipFrame.value = clampedFrame;
      dragTooltipPosition.value = clampedX - workareaRect.left;

      // Update filter
      const current = trackFilters.timeFilters.value;
      if (current) {
        if (draggingTimeFilter.value === 'start') {
          // Ensure start <= end
          const newStart = Math.min(clampedFrame, current[1]);
          trackFilters.setTimeFilters([newStart, current[1]]);
        } else if (draggingTimeFilter.value === 'end') {
          // Ensure end >= start
          const newEnd = Math.max(clampedFrame, current[0]);
          trackFilters.setTimeFilters([current[0], newEnd]);
        }
      }
    }

    function formatTimestamp(frame: number) {
      if (!isVideo.value || !frameRate.value) {
        return null;
      }
      return frameToTimestamp(frame, frameRate.value);
    }

    // Watchers
    watch(() => props.maxFrame, (value) => {
      endFrame.value = value;
      init.value = true;
      update();
    });

    watch(startFrame, () => {
      update();
    });

    watch(endFrame, () => {
      update();
    });

    watch(handLeftPosition, (value) => {
      if (hand.value) {
        hand.value.style.left = `${value || '-10'}px`;
      }
    });

    watch(timeFilterStartPosition, (value) => {
      if (timeFilterStartLine.value && value !== null) {
        timeFilterStartLine.value.style.left = `${value}px`;
      }
    });

    watch(timeFilterEndPosition, (value) => {
      if (timeFilterEndLine.value && value !== null) {
        timeFilterEndLine.value.style.left = `${value}px`;
      }
    });

    watch(() => props.frame, (frame) => {
      if (frame > endFrame.value) {
        endFrame.value = Math.min(frame + 200, props.maxFrame);
      } else if (frame < startFrame.value) {
        startFrame.value = Math.max(frame - 100, 0);
      }
    });

    watch(() => props.display, (val) => {
      if (!val) {
        clientHeight.value = 0;
      } else {
        initD3Timeline();
      }
    });

    // Lifecycle
    onMounted(() => {
      initD3Timeline();
      // Initialize endFrame from maxFrame prop
      endFrame.value = props.maxFrame;
      init.value = !!props.maxFrame || 1;
      // Add resize listener
      window.addEventListener('resize', resizeHandler);
    });

    onBeforeUnmount(() => {
      window.removeEventListener('resize', resizeHandler);
      if (resizeObserver.value && workarea.value) {
        resizeObserver.value.unobserve(workarea.value);
        resizeObserver.value.disconnect();
      }
      if (resizeTimer.value) {
        clearTimeout(resizeTimer.value);
      }
    });

    return {
      // Refs
      init,
      mounted,
      startFrame,
      endFrame,
      clientWidth,
      clientHeight,
      margin,
      draggingTimeFilter,
      dragTooltipFrame,
      dragTooltipPosition,
      // Template refs
      workarea,
      hand,
      timeFilterStartLine,
      timeFilterEndLine,
      minimap,
      timelineEl,
      // Computed
      minimapFillStyle,
      handLeftPosition,
      timeFilterActive,
      timeFilterStartFrame,
      timeFilterEndFrame,
      timeFilterStartPosition,
      timeFilterEndPosition,
      timeFilterLeftDimmingStyle,
      timeFilterRightDimmingStyle,
      isVideo,
      frameRate,
      dragTooltipText,
      // Methods
      onwheel,
      containerMouseup,
      containerMousemove,
      workareaMouseup,
      workareaMousedown,
      workareaMousemove,
      workareaMouseleave,
      minimapFillMousedown,
      timeFilterLineMousedown,
      formatTimestamp,
    };
  },
});
</script>

<template>
  <div
    ref="timelineEl"
    class="timeline"
    @wheel="onwheel"
    @mouseup="containerMouseup"
    @mousemove="containerMousemove"
  >
    <div
      ref="workarea"
      class="work-area"
      @mouseup="workareaMouseup"
      @mousedown="workareaMousedown"
      @mousemove="workareaMousemove"
      @mouseleave="workareaMouseleave"
    >
      <div
        v-if="timeFilterActive"
        class="time-filter-dimming time-filter-dimming-left"
        :style="timeFilterLeftDimmingStyle"
      />
      <div
        v-if="timeFilterActive"
        class="time-filter-dimming time-filter-dimming-right"
        :style="timeFilterRightDimmingStyle"
      />
      <div
        v-if="timeFilterActive && timeFilterStartPosition !== null"
        ref="timeFilterStartLine"
        class="time-filter-line time-filter-start-line"
        :style="{ left: `${timeFilterStartPosition}px` }"
        @mousedown="timeFilterLineMousedown($event, 'start')"
      />
      <div
        v-if="timeFilterActive && timeFilterEndPosition !== null"
        ref="timeFilterEndLine"
        class="time-filter-line time-filter-end-line"
        :style="{ left: `${timeFilterEndPosition}px` }"
        @mousedown="timeFilterLineMousedown($event, 'end')"
      />
      <div
        v-if="dragTooltipPosition !== null"
        class="time-filter-tooltip"
        :style="{ left: `${dragTooltipPosition}px` }"
      >
        {{ dragTooltipText }}
      </div>
      <div
        ref="hand"
        class="hand"
      />
      <div
        v-if="init && mounted"
        class="child"
      >
        <slot
          name="child"
          :start-frame="startFrame"
          :end-frame="endFrame"
          :max-frame="maxFrame"
          :client-width="clientWidth"
          :client-height="clientHeight"
          :margin="margin"
        />
      </div>
    </div>
    <div
      ref="minimap"
      class="minimap"
    >
      <div
        class="fill"
        :style="minimapFillStyle"
        @mousedown="minimapFillMousedown"
      >
        <!-- {{ rendered() }} -->
      </div>
    </div>
    <slot />
  </div>
</template>

<style lang="scss" scoped>
.timeline {
  min-height: 175px;
  position: relative;
  display: flex;
  flex-direction: column;

  .work-area {
    flex: 1;
    position: relative;
    overflow: hidden;

    .hand {
      position: absolute;
      top: 0;
      width: 0;
      height: 100%;
      border-left: 1px solid #299be3;
      z-index: 10;
    }

    .time-filter-line {
      position: absolute;
      top: 0;
      width: 0;
      height: 100%;
      z-index: 2;
      cursor: col-resize;
      pointer-events: auto;
    }

    .time-filter-tooltip {
      position: absolute;
      top: 30px;
      transform: translateX(-50%);
      background-color: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      pointer-events: none;
      z-index: 20;
    }

    .time-filter-start-line {
      border-left: 3px solid #4caf50;
    }

    .time-filter-end-line {
      border-left: 3px solid #f44336;
    }

    .time-filter-dimming {
      position: absolute;
      top: 0;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.3);
      pointer-events: none;
      z-index: 1;
    }

    .child {
      position: absolute;
      top: 0;
      bottom: 17px;
      left: 0;
      right: 0;
      z-index: 0;
    }
  }

  .minimap {
    height: 10px;

    .fill {
      position: relative;
      height: 100%;
      background-color: #80c6e8;
    }
  }
}
</style>

<style lang="scss">
.timeline {
  .tick {
    shape-rendering: crispEdges;
    font-size: 12px;
    stroke-opacity: 0.5;
    stroke-dasharray: 2, 2;
  }
}
</style>
