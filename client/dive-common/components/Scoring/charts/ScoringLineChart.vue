<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, PropType, ref,
} from 'vue';
import {
  curveLinear, curveStepAfter, line as d3Line, scaleLinear,
} from 'd3';
import type {
  ChartHover, ChartMarker, ChartPoint, ChartSeries,
} from './chartTypes';

const MARGIN = {
  top: 12, right: 16, bottom: 34, left: 46,
};

interface RenderedSeries {
  series: ChartSeries;
  path: string;
}

export default defineComponent({
  name: 'ScoringLineChart',
  props: {
    series: {
      type: Array as PropType<ChartSeries[]>,
      required: true,
    },
    xLabel: {
      type: String,
      default: '',
    },
    yLabel: {
      type: String,
      default: '',
    },
    xDomain: {
      type: Array as unknown as PropType<[number, number] | null>,
      default: null,
    },
    yDomain: {
      type: Array as unknown as PropType<[number, number] | null>,
      default: null,
    },
    markers: {
      type: Array as PropType<ChartMarker[]>,
      default: () => [],
    },
    /** Draw a highlighted vertical rule at this x, e.g. the chosen threshold */
    selectedX: {
      type: Number as PropType<number | null>,
      default: null,
    },
    height: {
      type: Number,
      default: 240,
    },
    /** Dark text and grid for printing on white */
    light: {
      type: Boolean,
      default: false,
    },
    step: {
      type: Boolean,
      default: false,
    },
    /** Format one tooltip line per entry; defaults to x, y and every meta value */
    tooltip: {
      type: Function as PropType<(hover: ChartHover) => string[]>,
      default: null,
    },
    xFormat: {
      type: Function as PropType<(v: number) => string>,
      default: (v: number) => v.toFixed(2),
    },
    yFormat: {
      type: Function as PropType<(v: number) => string>,
      default: (v: number) => v.toFixed(2),
    },
  },
  setup(props, { emit }) {
    const container = ref<HTMLDivElement | null>(null);
    const width = ref(0);
    const hidden = ref<Set<string>>(new Set());
    const hover = ref<ChartHover | null>(null);

    const innerWidth = computed(() => Math.max(0, width.value - MARGIN.left - MARGIN.right));
    const innerHeight = computed(() => Math.max(0, props.height - MARGIN.top - MARGIN.bottom));

    const visibleSeries = computed(() => props.series.filter((s) => !hidden.value.has(s.name)));
    const allPoints = computed(() => visibleSeries.value.flatMap((s) => s.points));

    const xScale = computed(() => {
      let lo = props.xDomain ? props.xDomain[0] : Infinity;
      let hi = props.xDomain ? props.xDomain[1] : -Infinity;
      if (!props.xDomain) {
        allPoints.value.forEach((p) => { lo = Math.min(lo, p.x); hi = Math.max(hi, p.x); });
        if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
        if (lo === hi) hi = lo + 1;
      }
      return scaleLinear<number, number>().domain([lo, hi]).range([0, innerWidth.value]).nice();
    });

    const yScale = computed(() => {
      const lo = props.yDomain ? props.yDomain[0] : 0;
      let hi = props.yDomain ? props.yDomain[1] : 0;
      if (!props.yDomain) {
        allPoints.value.forEach((p) => { hi = Math.max(hi, p.y); });
        hi = hi > 0 ? hi * 1.05 : 1;
      }
      return scaleLinear<number, number>().domain([lo, hi]).range([innerHeight.value, 0]).nice();
    });

    const sx = (v: number) => xScale.value(v) ?? 0;
    const sy = (v: number) => yScale.value(v) ?? 0;

    const xTicks = computed(() => xScale.value.ticks(6));
    const yTicks = computed(() => yScale.value.ticks(5));

    const rendered = computed<RenderedSeries[]>(() => {
      const generator = d3Line<ChartPoint>()
        .curve(props.step ? curveStepAfter : curveLinear)
        .x((p) => sx(p.x))
        .y((p) => sy(p.y));
      return visibleSeries.value.map((series) => ({
        series,
        path: generator(series.points) || '',
      }));
    });

    const visibleMarkers = computed(() => {
      const [lo, hi] = xScale.value.domain();
      return props.markers.filter((m) => m.x >= lo && m.x <= hi);
    });

    const selectedPx = computed(() => (props.selectedX !== null && Number.isFinite(props.selectedX)
      ? sx(props.selectedX) : null));

    function toggleSeries(name: string) {
      const next = new Set(hidden.value);
      if (next.has(name)) next.delete(name); else next.add(name);
      hidden.value = next;
    }

    function tooltipLines(h: ChartHover): string[] {
      if (props.tooltip) return props.tooltip(h);
      const lines = [h.series.name, `${props.xLabel || 'x'}: ${props.xFormat(h.point.x)}`, `${props.yLabel || 'y'}: ${props.yFormat(h.point.y)}`];
      Object.entries(h.point.meta || {}).forEach(([k, v]) => {
        lines.push(`${k}: ${typeof v === 'number' ? v.toFixed(3) : String(v ?? 'n/a')}`);
      });
      return lines;
    }

    function nearest(mx: number, my: number): ChartHover | null {
      let bestSeries: ChartSeries | null = null;
      let bestPoint: ChartPoint | null = null;
      let bestDist = Infinity;
      visibleSeries.value.forEach((s) => {
        s.points.forEach((p) => {
          const dx = sx(p.x) - mx;
          const dy = sy(p.y) - my;
          // Weight x more: curves are read left to right and points bunch vertically
          const dist = dx * dx + dy * dy * 0.25;
          if (dist < bestDist) {
            bestDist = dist;
            bestSeries = s;
            bestPoint = p;
          }
        });
      });
      return bestSeries && bestPoint ? { series: bestSeries, point: bestPoint } : null;
    }

    function localPoint(event: MouseEvent): [number, number] {
      const rect = (event.currentTarget as SVGRectElement).getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    }

    function onMove(event: MouseEvent) {
      const [mx, my] = localPoint(event);
      const found = nearest(mx, my);
      hover.value = found;
      emit('hover', found);
    }

    function onLeave() {
      hover.value = null;
      emit('hover', null);
    }

    function onClick(event: MouseEvent) {
      const [mx, my] = localPoint(event);
      const found = nearest(mx, my);
      if (found) emit('click', found);
    }

    const hoverX = computed(() => (hover.value ? sx(hover.value.point.x) : 0));
    const hoverY = computed(() => (hover.value ? sy(hover.value.point.y) : 0));
    const tooltipStyle = computed(() => {
      if (!hover.value) return { display: 'none' };
      const left = MARGIN.left + hoverX.value;
      const flip = left > width.value * 0.6;
      return {
        top: `${Math.max(0, MARGIN.top + hoverY.value - 10)}px`,
        ...(flip ? { right: `${width.value - left + 10}px` } : { left: `${left + 10}px` }),
      };
    });

    let observer: ResizeObserver | null = null;
    onMounted(() => {
      if (container.value) {
        width.value = container.value.clientWidth;
        observer = new ResizeObserver((entries) => {
          const next = Math.floor(entries[0]?.contentRect.width ?? 0);
          if (next !== width.value) width.value = next;
        });
        observer.observe(container.value);
      }
    });
    onBeforeUnmount(() => {
      observer?.disconnect();
    });

    return {
      container,
      width,
      hidden,
      hover,
      hoverX,
      hoverY,
      tooltipStyle,
      tooltipLines,
      toggleSeries,
      innerWidth,
      innerHeight,
      sx,
      sy,
      xTicks,
      yTicks,
      rendered,
      visibleMarkers,
      selectedPx,
      onMove,
      onLeave,
      onClick,
      MARGIN,
    };
  },
});
</script>

<template>
  <div
    class="scoring-line-chart"
    :class="{ light }"
  >
    <div
      ref="container"
      class="chart-area"
      :style="{ height: `${height}px` }"
    >
      <svg
        v-if="width > 40"
        :width="width"
        :height="height"
        style="display: block;"
      >
        <g :transform="`translate(${MARGIN.left},${MARGIN.top})`">
          <g class="grid">
            <line
              v-for="t in yTicks"
              :key="`g${t}`"
              :x1="0"
              :x2="innerWidth"
              :y1="sy(t)"
              :y2="sy(t)"
            />
          </g>
          <g class="axis">
            <line
              :x1="0"
              :x2="innerWidth"
              :y1="innerHeight"
              :y2="innerHeight"
            />
            <g
              v-for="t in xTicks"
              :key="`x${t}`"
            >
              <line
                :x1="sx(t)"
                :x2="sx(t)"
                :y1="innerHeight"
                :y2="innerHeight + 4"
              />
              <text
                :x="sx(t)"
                :y="innerHeight + 15"
                text-anchor="middle"
              >{{ xFormat(t) }}</text>
            </g>
            <line
              :x1="0"
              :x2="0"
              :y1="0"
              :y2="innerHeight"
            />
            <g
              v-for="t in yTicks"
              :key="`y${t}`"
            >
              <line
                :x1="-4"
                :x2="0"
                :y1="sy(t)"
                :y2="sy(t)"
              />
              <text
                :x="-7"
                :y="sy(t) + 3"
                text-anchor="end"
              >{{ yFormat(t) }}</text>
            </g>
          </g>
          <text
            v-if="xLabel"
            class="axis-label"
            :x="innerWidth / 2"
            :y="innerHeight + 30"
            text-anchor="middle"
          >{{ xLabel }}</text>
          <text
            v-if="yLabel"
            class="axis-label"
            :transform="`rotate(-90) translate(${-innerHeight / 2}, -34)`"
            text-anchor="middle"
          >{{ yLabel }}</text>
          <path
            v-for="r in rendered"
            :key="r.series.name"
            class="series"
            :d="r.path"
            :style="{ stroke: r.series.color, strokeDasharray: r.series.dashed ? '4,3' : undefined }"
          />
          <g
            v-for="m in visibleMarkers"
            :key="`m${m.label}${m.x}`"
          >
            <line
              class="marker"
              :x1="sx(m.x)"
              :x2="sx(m.x)"
              :y1="0"
              :y2="innerHeight"
              :style="{ stroke: m.color || '#aaa' }"
            />
            <text
              class="marker-label"
              :x="sx(m.x) + 3"
              :y="10"
              :style="{ fill: m.color || '#aaa' }"
            >{{ m.label }}</text>
          </g>
          <line
            v-if="selectedPx !== null"
            class="selected"
            :x1="selectedPx"
            :x2="selectedPx"
            :y1="0"
            :y2="innerHeight"
          />
          <g v-if="hover">
            <line
              class="crosshair"
              :x1="hoverX"
              :x2="hoverX"
              :y1="0"
              :y2="innerHeight"
            />
            <circle
              class="hover-dot"
              :cx="hoverX"
              :cy="hoverY"
              r="4"
              :style="{ fill: hover.series.color }"
            />
          </g>
          <rect
            class="overlay"
            :width="innerWidth"
            :height="innerHeight"
            @mousemove="onMove"
            @mouseleave="onLeave"
            @click="onClick"
          />
        </g>
      </svg>
    </div>
    <div
      v-if="hover"
      class="chart-tooltip"
      :style="tooltipStyle"
    >
      <div
        v-for="(line, i) in tooltipLines(hover)"
        :key="i"
        :class="{ 'font-weight-bold': i === 0 }"
      >
        {{ line }}
      </div>
    </div>
    <div
      v-if="series.length > 1"
      class="chart-legend"
    >
      <span
        v-for="s in series"
        :key="s.name"
        class="legend-item"
        :class="{ 'legend-hidden': hidden.has(s.name) }"
        @click="toggleSeries(s.name)"
      >
        <span
          class="legend-swatch"
          :style="{ background: s.color, borderStyle: s.dashed ? 'dashed' : 'solid' }"
        />
        {{ s.name }}
      </span>
    </div>
  </div>
</template>

<style lang="scss">
.scoring-line-chart {
  position: relative;
  width: 100%;

  .chart-area {
    width: 100%;
  }

  .series {
    fill: none;
    stroke-width: 1.8px;
  }

  .grid line {
    stroke: #444;
  }

  .axis {
    font-size: 11px;

    line {
      stroke: #888;
    }

    text {
      fill: #ccc;
    }
  }

  .axis-label {
    fill: #ccc;
    font-size: 11px;
  }

  .marker {
    stroke-dasharray: 3, 3;
    stroke-width: 1px;
  }

  .marker-label {
    font-size: 10px;
  }

  .selected {
    stroke: #ffeb3b;
    stroke-width: 1.5px;
  }

  .crosshair {
    stroke: #888;
    stroke-width: 1px;
    pointer-events: none;
  }

  .hover-dot {
    stroke: white;
    stroke-width: 1px;
    pointer-events: none;
  }

  .overlay {
    fill: none;
    pointer-events: all;
  }

  .chart-tooltip {
    position: absolute;
    background: rgba(0, 0, 0, 0.9);
    border: 1px solid #888;
    border-radius: 3px;
    padding: 2px 6px;
    font-size: 12px;
    pointer-events: none;
    white-space: nowrap;
    z-index: 5;
  }

  &.light {
    .grid line {
      stroke: #ddd;
    }

    .axis line {
      stroke: #666;
    }

    .axis text,
    .axis-label {
      fill: #222;
    }

    .selected {
      stroke: #b8860b;
    }

    .chart-legend {
      color: #222;
    }
  }

  .chart-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12px;
    padding: 2px 8px;

    .legend-item {
      cursor: pointer;
      user-select: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .legend-hidden {
      opacity: 0.4;
      text-decoration: line-through;
    }

    .legend-swatch {
      display: inline-block;
      width: 14px;
      height: 3px;
      border-bottom: 2px solid transparent;
    }
  }
}
</style>
