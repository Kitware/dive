<script lang="ts">
import {
  computed, defineComponent, PropType, ref,
} from 'vue';
import * as d3 from 'd3';

interface CellHover {
  row: number;
  col: number;
  count: number;
  fraction: number | null;
}

export default defineComponent({
  name: 'ScoringHeatmap',
  props: {
    rowLabels: {
      type: Array as PropType<string[]>,
      required: true,
    },
    colLabels: {
      type: Array as PropType<string[]>,
      required: true,
    },
    counts: {
      type: Array as PropType<number[][]>,
      required: true,
    },
    fractions: {
      type: Array as PropType<(number | null)[][]>,
      default: () => [],
    },
    showFractions: {
      type: Boolean,
      default: false,
    },
    rowTitle: {
      type: String,
      default: 'Truth',
    },
    colTitle: {
      type: String,
      default: 'Computed',
    },
    /** Row/column index treated as background and drawn muted */
    backgroundIndex: {
      type: Number,
      default: -1,
    },
    selected: {
      type: Object as PropType<{ row: number; col: number } | null>,
      default: null,
    },
  },
  setup(props, { emit }) {
    const hover = ref<CellHover | null>(null);
    const cellSize = computed(() => {
      const n = Math.max(props.rowLabels.length, props.colLabels.length, 1);
      return Math.max(28, Math.min(64, Math.floor(420 / n)));
    });
    const labelWidth = computed(() => {
      const longest = Math.max(...props.rowLabels.map((l) => l.length), 4);
      return Math.min(160, 8 + longest * 7);
    });
    const colLabelHeight = computed(() => {
      const longest = Math.max(...props.colLabels.map((l) => l.length), 4);
      return Math.min(140, 12 + longest * 6);
    });
    const width = computed(() => labelWidth.value + props.colLabels.length * cellSize.value + 4);
    const height = computed(() => colLabelHeight.value + props.rowLabels.length * cellSize.value + 4);

    const colorFor = computed(() => {
      const maxCount = d3.max(props.counts.flat()) || 1;
      return (r: number, c: number) => {
        const isBackground = r === props.backgroundIndex || c === props.backgroundIndex;
        const fraction = props.fractions[r]?.[c];
        const t = props.showFractions && fraction !== null && fraction !== undefined
          ? fraction
          : (props.counts[r]?.[c] ?? 0) / maxCount;
        if (r === c && !isBackground) {
          return d3.interpolateRgb('#1e2a1e', '#4caf50')(Math.max(0.12, t));
        }
        if (isBackground) {
          return d3.interpolateRgb('#262626', '#ff9800')(t * 0.9);
        }
        return d3.interpolateRgb('#262626', '#e53935')(t);
      };
    });

    function cellText(r: number, c: number) {
      const count = props.counts[r]?.[c] ?? 0;
      if (props.showFractions) {
        const f = props.fractions[r]?.[c];
        return f === null || f === undefined ? '' : `${(f * 100).toFixed(0)}%`;
      }
      return String(count);
    }

    function onHover(r: number, c: number) {
      hover.value = {
        row: r,
        col: c,
        count: props.counts[r]?.[c] ?? 0,
        fraction: props.fractions[r]?.[c] ?? null,
      };
    }

    function onClick(r: number, c: number) {
      emit('select', { row: r, col: c });
    }

    return {
      hover,
      cellSize,
      labelWidth,
      colLabelHeight,
      width,
      height,
      colorFor,
      cellText,
      onHover,
      onClick,
    };
  },
});
</script>

<template>
  <div class="scoring-heatmap">
    <svg
      :width="width"
      :height="height"
      @mouseleave="hover = null"
    >
      <text
        :x="labelWidth + (colLabels.length * cellSize) / 2"
        :y="12"
        class="axis-title"
        text-anchor="middle"
      >{{ colTitle }}</text>
      <text
        :x="12"
        :y="colLabelHeight + (rowLabels.length * cellSize) / 2"
        class="axis-title"
        text-anchor="middle"
        :transform="`rotate(-90 12 ${colLabelHeight + (rowLabels.length * cellSize) / 2})`"
      >{{ rowTitle }}</text>
      <g
        v-for="(label, c) in colLabels"
        :key="`c${c}`"
      >
        <text
          :x="labelWidth + c * cellSize + cellSize / 2"
          :y="colLabelHeight - 6"
          class="cell-label"
          text-anchor="start"
          :transform="`rotate(-45 ${labelWidth + c * cellSize + cellSize / 2} ${colLabelHeight - 6})`"
        >{{ label }}</text>
      </g>
      <g
        v-for="(label, r) in rowLabels"
        :key="`r${r}`"
      >
        <text
          :x="labelWidth - 6"
          :y="colLabelHeight + r * cellSize + cellSize / 2 + 4"
          class="cell-label"
          text-anchor="end"
        >{{ label }}</text>
        <g
          v-for="(_, c) in colLabels"
          :key="`cell${r}-${c}`"
          class="cell"
          @mousemove="onHover(r, c)"
          @click="onClick(r, c)"
        >
          <rect
            :x="labelWidth + c * cellSize"
            :y="colLabelHeight + r * cellSize"
            :width="cellSize - 1"
            :height="cellSize - 1"
            :fill="colorFor(r, c)"
            :stroke="selected && selected.row === r && selected.col === c ? '#ffeb3b' : (hover && hover.row === r && hover.col === c ? 'white' : 'none')"
            stroke-width="1.5"
          />
          <text
            :x="labelWidth + c * cellSize + cellSize / 2"
            :y="colLabelHeight + r * cellSize + cellSize / 2 + 4"
            class="cell-value"
            text-anchor="middle"
          >{{ cellText(r, c) }}</text>
        </g>
      </g>
    </svg>
    <div
      v-if="hover"
      class="heatmap-tooltip"
    >
      <b>{{ rowTitle }}: {{ rowLabels[hover.row] }}</b> → <b>{{ colTitle }}: {{ colLabels[hover.col] }}</b>
      <div>
        {{ hover.count }} object{{ hover.count === 1 ? '' : 's' }}
        <span v-if="hover.fraction !== null">({{ (hover.fraction * 100).toFixed(1) }}% of this {{ rowTitle.toLowerCase() }} row)</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.scoring-heatmap {
  display: inline-block;
  position: relative;

  .axis-title {
    fill: #ccc;
    font-size: 12px;
    font-weight: bold;
  }

  .cell-label {
    fill: #ddd;
    font-size: 11px;
  }

  .cell {
    cursor: pointer;
  }

  .cell-value {
    fill: white;
    font-size: 11px;
    pointer-events: none;
  }

  .heatmap-tooltip {
    font-size: 12px;
    padding: 2px 6px;
    color: #ddd;
  }
}
</style>
