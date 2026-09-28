<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, PropType, ref, shallowRef, watch,
} from 'vue';
import {
  DEFAULT_ORBIT, normalizePositions, orbitDrag, orbitZoom, paintOrder, pick, project,
  Orbit, Projected, SpacePoint,
} from 'platform/desktop/frontend/resultSpace';

/** What the view knows about one placed result. */
export interface SpaceCell {
  key: string;
  /** 1-based rank in the result list. */
  rank: number;
  /** Rendered chip (data URL), once loaded. */
  chip: string | null;
  adjudication: '' | 'positive' | 'negative';
  title: string;
  subtitle: string;
  score: number;
  /** Descriptor distance from the query. */
  distance: number;
}

/** Billboard half-size in canvas pixels at scale 1. */
const HALF_SIZE = 26;
const EXEMPLAR_HALF_SIZE = 34;
const COLORS = {
  background: '#121212',
  axis: 'rgba(255, 255, 255, 0.08)',
  line: 'rgba(255, 255, 255, 0.28)',
  positive: '#4caf50',
  negative: '#ff5252',
  neutral: 'rgba(255, 255, 255, 0.55)',
  exemplar: '#ffc107',
  focus: '#00e5ff',
  label: 'rgba(0, 0, 0, 0.7)',
};
/** Idle rotation speed while auto-spin is on. */
const SPIN_RADIANS_PER_MS = 0.00025;

/**
 * Results as chips floating around the query in 3D descriptor space, each
 * tied to the query by a line; nearer chips are more similar. Drag orbits,
 * the wheel zooms, hovering names a result, clicking selects it for
 * marking, double clicking opens it.
 */
export default defineComponent({
  name: 'VideoSearchResultsSpace',
  props: {
    points: {
      type: Array as PropType<SpacePoint[]>,
      required: true,
    },
    cells: {
      type: Array as PropType<SpaceCell[]>,
      required: true,
    },
    /** Image of the query exemplar for the center marker. */
    exemplarUrl: {
      type: String,
      default: '',
    },
    loading: {
      type: Boolean,
      default: false,
    },
    /** Results that could not be placed (no stored descriptor). */
    missingCount: {
      type: Number,
      default: 0,
    },
    error: {
      type: String,
      default: '',
    },
  },
  setup(props, { emit }) {
    const container = ref<HTMLDivElement | null>(null);
    const canvas = ref<HTMLCanvasElement | null>(null);
    const orbit = ref<Orbit>({ ...DEFAULT_ORBIT });
    const spin = ref(false);
    const hovered = ref<string | null>(null);
    const selected = ref<string | null>(null);
    const cursor = ref({ x: 0, y: 0 });
    const size = ref({ width: 0, height: 0 });

    const cellsByKey = computed(() => new Map(props.cells.map((cell) => [cell.key, cell])));
    const normalized = computed(() => normalizePositions(props.points));
    const projected = shallowRef<Projected[]>([]);

    const images = new Map<string, HTMLImageElement>();
    function imageFor(src: string): HTMLImageElement | null {
      const cached = images.get(src);
      if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
      const image = new Image();
      image.onload = () => requestDraw();
      image.src = src;
      images.set(src, image);
      return null;
    }

    let frame = 0;
    let lastTick = 0;
    function requestDraw() {
      if (frame) return;
      frame = window.requestAnimationFrame((now) => {
        frame = 0;
        if (spin.value && !dragging) {
          const elapsed = lastTick ? now - lastTick : 0;
          orbit.value = { ...orbit.value, yaw: orbit.value.yaw + elapsed * SPIN_RADIANS_PER_MS };
        }
        lastTick = now;
        draw();
        if (spin.value) requestDraw();
      });
    }

    function strokeFor(cell: SpaceCell | undefined, focused: boolean): string {
      if (focused) return COLORS.focus;
      if (cell?.adjudication === 'positive') return COLORS.positive;
      if (cell?.adjudication === 'negative') return COLORS.negative;
      return COLORS.neutral;
    }

    function drawBillboard(
      ctx: CanvasRenderingContext2D,
      p: { x: number; y: number; scale: number },
      half: number,
      src: string | null,
      stroke: string,
      lineWidth: number,
      label?: string,
    ) {
      const h = half * p.scale;
      const image = src ? imageFor(src) : null;
      ctx.save();
      if (image) {
        ctx.drawImage(image, p.x - h, p.y - h, 2 * h, 2 * h);
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(p.x - h, p.y - h, 2 * h, 2 * h);
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(p.x - h, p.y - h, 2 * h, 2 * h);
      if (label && h >= 14) {
        ctx.font = `${Math.max(9, Math.round(10 * p.scale))}px sans-serif`;
        const width = ctx.measureText(label).width + 6;
        ctx.fillStyle = COLORS.label;
        ctx.fillRect(p.x - h, p.y - h, width, 13 * Math.max(0.8, p.scale));
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'top';
        ctx.fillText(label, p.x - h + 3, p.y - h + 2);
      }
      ctx.restore();
    }

    function draw() {
      const el = canvas.value;
      const { width, height } = size.value;
      if (!el || !width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(width * dpr) || el.height !== Math.round(height * dpr)) {
        el.width = Math.round(width * dpr);
        el.height = Math.round(height * dpr);
      }
      const ctx = el.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, width, height);

      const viewport = { width, height };
      const [center] = project([{ key: '', position: [0, 0, 0] }], orbit.value, viewport);
      const axisEnds = project([
        { key: 'x', position: [1, 0, 0] }, { key: '-x', position: [-1, 0, 0] },
        { key: 'y', position: [0, 1, 0] }, { key: '-y', position: [0, -1, 0] },
        { key: 'z', position: [0, 0, 1] }, { key: '-z', position: [0, 0, -1] },
      ], orbit.value, viewport);
      ctx.strokeStyle = COLORS.axis;
      ctx.lineWidth = 1;
      for (let i = 0; i < axisEnds.length; i += 2) {
        ctx.beginPath();
        ctx.moveTo(axisEnds[i].x, axisEnds[i].y);
        ctx.lineTo(axisEnds[i + 1].x, axisEnds[i + 1].y);
        ctx.stroke();
      }

      const ordered = paintOrder(project(normalized.value, orbit.value, viewport));
      projected.value = ordered;
      ordered.forEach((p) => {
        const cell = cellsByKey.value.get(p.key);
        const focused = p.key === hovered.value || p.key === selected.value;
        ctx.strokeStyle = focused || cell?.adjudication ? strokeFor(cell, focused) : COLORS.line;
        ctx.lineWidth = focused ? 2 : 1;
        ctx.globalAlpha = focused ? 1 : Math.min(1, 0.35 + p.scale * 0.5);
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      // The exemplar paints in depth order with the results (it sits at the origin).
      let exemplarDrawn = false;
      ordered.forEach((p) => {
        if (!exemplarDrawn && p.depth <= center.depth) {
          drawBillboard(ctx, center, EXEMPLAR_HALF_SIZE, props.exemplarUrl || null, COLORS.exemplar, 2, 'Query');
          exemplarDrawn = true;
        }
        const cell = cellsByKey.value.get(p.key);
        const focused = p.key === hovered.value || p.key === selected.value;
        drawBillboard(ctx, p, HALF_SIZE, cell?.chip ?? null, strokeFor(cell, focused), focused ? 3 : 1.5, cell ? `#${cell.rank}` : undefined);
      });
      if (!exemplarDrawn) {
        drawBillboard(ctx, center, EXEMPLAR_HALF_SIZE, props.exemplarUrl || null, COLORS.exemplar, 2, 'Query');
      }
    }

    // ---- interaction ------------------------------------------------------

    let dragging = false;
    let dragMoved = false;
    let last = { x: 0, y: 0 };

    function localPoint(event: MouseEvent) {
      const rect = canvas.value?.getBoundingClientRect();
      return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    }

    function onMouseDown(event: MouseEvent) {
      if (event.button !== 0) return;
      dragging = true;
      dragMoved = false;
      last = { x: event.clientX, y: event.clientY };
    }

    function onMouseMove(event: MouseEvent) {
      cursor.value = localPoint(event);
      if (dragging) {
        const dx = event.clientX - last.x;
        const dy = event.clientY - last.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
        last = { x: event.clientX, y: event.clientY };
        orbit.value = orbitDrag(orbit.value, dx, dy);
        return;
      }
      const hit = pick(projected.value, cursor.value.x, cursor.value.y, HALF_SIZE);
      hovered.value = hit?.key ?? null;
    }

    function onMouseUp(event: MouseEvent) {
      if (!dragging) return;
      dragging = false;
      if (dragMoved) return;
      const { x, y } = localPoint(event);
      const hit = pick(projected.value, x, y, HALF_SIZE);
      selected.value = hit?.key ?? null;
    }

    function onMouseLeave() {
      hovered.value = null;
      dragging = false;
    }

    function onDoubleClick(event: MouseEvent) {
      const { x, y } = localPoint(event);
      const hit = pick(projected.value, x, y, HALF_SIZE);
      if (hit) emit('open', hit.key);
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      orbit.value = orbitZoom(orbit.value, event.deltaY);
    }

    function resetView() {
      orbit.value = { ...DEFAULT_ORBIT };
    }

    const selectedCell = computed(() => (selected.value ? cellsByKey.value.get(selected.value) ?? null : null));
    const hoveredCell = computed(() => (hovered.value && hovered.value !== selected.value
      ? cellsByKey.value.get(hovered.value) ?? null : null));
    const tooltipStyle = computed(() => ({
      left: `${Math.min(cursor.value.x + 14, Math.max(0, size.value.width - 220))}px`,
      top: `${Math.min(cursor.value.y + 14, Math.max(0, size.value.height - 60))}px`,
    }));

    watch([orbit, hovered, selected, normalized, () => props.cells, () => props.exemplarUrl], () => requestDraw(), { deep: true });
    watch(spin, (on) => {
      lastTick = 0;
      if (on) requestDraw();
    });
    watch(() => props.points, () => {
      if (selected.value && !props.points.some((p) => p.key === selected.value)) selected.value = null;
    });

    let observer: ResizeObserver | null = null;
    onMounted(() => {
      const el = container.value;
      if (!el) return;
      const measure = () => {
        size.value = { width: el.clientWidth, height: el.clientHeight };
        requestDraw();
      };
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(el);
      }
      measure();
    });
    onBeforeUnmount(() => {
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      images.clear();
    });

    return {
      container,
      canvas,
      spin,
      selected,
      selectedCell,
      hoveredCell,
      tooltipStyle,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave,
      onDoubleClick,
      onWheel,
      resetView,
    };
  },
});
</script>

<template>
  <div
    ref="container"
    class="results-space"
  >
    <canvas
      ref="canvas"
      class="results-space-canvas"
      :class="{ 'results-space-hover': hoveredCell }"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseLeave"
      @dblclick="onDoubleClick"
      @wheel="onWheel"
    />
    <div class="results-space-tools">
      <v-btn
        icon
        small
        title="Reset the view"
        @click="resetView"
      >
        <v-icon small>
          mdi-restore
        </v-icon>
      </v-btn>
      <v-btn
        icon
        small
        :color="spin ? 'primary' : undefined"
        title="Slowly rotate the view"
        @click="spin = !spin"
      >
        <v-icon small>
          mdi-rotate-3d
        </v-icon>
      </v-btn>
    </div>
    <div
      v-if="hoveredCell"
      class="results-space-tooltip text-caption"
      :style="tooltipStyle"
    >
      <div>#{{ hoveredCell.rank }} · {{ hoveredCell.title }}</div>
      <div class="grey--text">
        score {{ hoveredCell.score.toFixed(3) }} · distance {{ hoveredCell.distance.toFixed(2) }}
      </div>
    </div>
    <v-card
      v-if="selectedCell"
      class="results-space-selected pa-2"
      outlined
    >
      <div class="d-flex align-center">
        <img
          v-if="selectedCell.chip"
          :src="selectedCell.chip"
          class="results-space-selected-chip mr-2"
        >
        <div class="text-caption flex-grow-1">
          <div>#{{ selectedCell.rank }} · {{ selectedCell.subtitle }}</div>
          <div class="grey--text">
            score {{ selectedCell.score.toFixed(3) }} · distance {{ selectedCell.distance.toFixed(2) }}
          </div>
        </div>
        <v-btn
          icon
          small
          @click="selected = null"
        >
          <v-icon small>
            mdi-close
          </v-icon>
        </v-btn>
      </div>
      <div class="d-flex mt-1">
        <v-btn
          icon
          small
          color="success"
          title="Mark as a correct match"
          @click="$emit('mark', selectedCell.key, 'positive')"
        >
          <v-icon>
            {{ selectedCell.adjudication === 'positive' ? 'mdi-check-circle' : 'mdi-check-circle-outline' }}
          </v-icon>
        </v-btn>
        <v-btn
          icon
          small
          color="error"
          title="Mark as an incorrect match"
          @click="$emit('mark', selectedCell.key, 'negative')"
        >
          <v-icon>
            {{ selectedCell.adjudication === 'negative' ? 'mdi-close-circle' : 'mdi-close-circle-outline' }}
          </v-icon>
        </v-btn>
        <v-spacer />
        <v-btn
          small
          text
          title="Open in the annotation viewer (or double click)"
          @click="$emit('open', selectedCell.key)"
        >
          <v-icon
            small
            left
          >
            mdi-open-in-new
          </v-icon>
          Open
        </v-btn>
      </div>
    </v-card>
    <div
      v-if="loading"
      class="results-space-status text-caption"
    >
      <v-progress-circular
        indeterminate
        size="14"
        width="2"
        class="mr-2"
      />
      Placing results...
    </div>
    <div
      v-else-if="error"
      class="results-space-status text-caption error--text"
    >
      {{ error }}
    </div>
    <div
      v-else-if="!points.length"
      class="results-space-status text-caption grey--text"
    >
      No results to place.
    </div>
    <div
      v-else-if="missingCount"
      class="results-space-status text-caption grey--text"
    >
      {{ missingCount }} result{{ missingCount === 1 ? '' : 's' }} without a stored descriptor left out.
    </div>
  </div>
</template>

<style scoped>
.results-space {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  user-select: none;
}
.results-space-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}
.results-space-canvas.results-space-hover {
  cursor: pointer;
}
.results-space-tools {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 2px;
}
.results-space-tooltip {
  position: absolute;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 3px;
  padding: 4px 8px;
  max-width: 220px;
  white-space: nowrap;
}
.results-space-selected {
  position: absolute;
  left: 8px;
  bottom: 8px;
  width: 300px;
  background: rgba(18, 18, 18, 0.92);
}
.results-space-selected-chip {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 2px;
}
.results-space-status {
  position: absolute;
  left: 8px;
  top: 8px;
  display: flex;
  align-items: center;
  pointer-events: none;
}
</style>
