<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, PropType, ref, shallowRef, watch,
} from 'vue';
import {
  billboardHalfSize, DEFAULT_ORBIT, normalizePositions, orbitDrag, orbitPan, orbitZoom,
  paintOrder, pick, pickInBox, project,
  CanvasBox, Orbit, Projected, SpacePoint,
} from 'platform/desktop/frontend/resultSpace';
import ReviewTypeField from 'dive-common/components/Review/ReviewTypeField.vue';

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
  /** Annotation type, once the result has been taken up as an annotation. */
  type: string;
  /** Whether the result is an annotation that can be deleted. */
  adopted: boolean;
  /** Moves on when annotations are edited, so the cells are rebuilt. */
  revision: number;
}

type Adjudication = 'positive' | 'negative';
/** What a press of the mouse is doing until it is released. */
type Gesture = 'orbit' | 'pan' | 'box' | null;

/** Billboard half-size in canvas pixels at scale 1, and the least it shrinks to. */
const HALF_SIZE = 26;
const SMALLEST_HALF_SIZE = 8;
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
  box: 'rgba(0, 229, 255, 0.9)',
  boxFill: 'rgba(0, 229, 255, 0.12)',
};
/** Idle rotation speed while auto-spin is on. */
const SPIN_RADIANS_PER_MS = 0.00025;

/**
 * Results as chips floating around the query in 3D descriptor space, each
 * tied to the query by a line; nearer chips are more similar. Drag orbits,
 * a middle drag slides the view, the wheel zooms, hovering names a result,
 * clicking selects it for marking, double clicking opens it. A box drawn
 * with shift held (or with the box tool on) selects every result it
 * touches, to mark, retype or delete together.
 */
export default defineComponent({
  name: 'VideoSearchResultsSpace',
  components: { ReviewTypeField },
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
    /** Whether results can be given a type and deleted as annotations. */
    editable: {
      type: Boolean,
      default: false,
    },
    typeOptions: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },
  setup(props, { emit }) {
    const container = ref<HTMLDivElement | null>(null);
    const canvas = ref<HTMLCanvasElement | null>(null);
    const orbit = ref<Orbit>({ ...DEFAULT_ORBIT });
    const spin = ref(false);
    const hovered = ref<string | null>(null);
    const selected = ref<string[]>([]);
    const selectedSet = computed(() => new Set(selected.value));
    const boxTool = ref(false);
    const drawnBox = ref<CanvasBox | null>(null);
    const cursor = ref({ x: 0, y: 0 });
    const size = ref({ width: 0, height: 0 });

    const cellsByKey = computed(() => new Map(props.cells.map((cell) => [cell.key, cell])));
    const halfSize = computed(() => billboardHalfSize(
      props.points.length,
      HALF_SIZE,
      SMALLEST_HALF_SIZE,
    ));
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
        if (spin.value && !gesture) {
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

    /**
     * Chips are cropped to their box, so each billboard takes its chip's
     * shape: the longer side spans the full size, the other in proportion.
     */
    function shapeOf(key: string): [number, number] {
      const src = cellsByKey.value.get(key)?.chip;
      const image = src ? images.get(src) : undefined;
      if (!image || !image.naturalWidth || !image.naturalHeight) return [1, 1];
      const longest = Math.max(image.naturalWidth, image.naturalHeight);
      return [image.naturalWidth / longest, image.naturalHeight / longest];
    }

    function drawBillboard(
      ctx: CanvasRenderingContext2D,
      p: { x: number; y: number; scale: number },
      half: number,
      src: string | null,
      stroke: string,
      lineWidth: number,
      label?: string,
      shape: [number, number] = [1, 1],
    ) {
      const w = half * p.scale * shape[0];
      const h = half * p.scale * shape[1];
      const image = src ? imageFor(src) : null;
      ctx.save();
      if (image) {
        ctx.drawImage(image, p.x - w, p.y - h, 2 * w, 2 * h);
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(p.x - w, p.y - h, 2 * w, 2 * h);
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(p.x - w, p.y - h, 2 * w, 2 * h);
      if (label && half * p.scale >= 14) {
        ctx.font = `${Math.max(9, Math.round(10 * p.scale))}px sans-serif`;
        const width = ctx.measureText(label).width + 6;
        ctx.fillStyle = COLORS.label;
        ctx.fillRect(p.x - w, p.y - h, width, 13 * Math.max(0.8, p.scale));
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'top';
        ctx.fillText(label, p.x - w + 3, p.y - h + 2);
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
      const isFocused = (key: string) => key === hovered.value || selectedSet.value.has(key);
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
        const focused = isFocused(p.key);
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
        const focused = isFocused(p.key);
        drawBillboard(
          ctx,
          p,
          halfSize.value,
          cell?.chip ?? null,
          strokeFor(cell, focused),
          focused ? 3 : 1.5,
          cell ? `#${cell.rank}` : undefined,
          shapeOf(p.key),
        );
      });
      if (!exemplarDrawn) {
        drawBillboard(ctx, center, EXEMPLAR_HALF_SIZE, props.exemplarUrl || null, COLORS.exemplar, 2, 'Query');
      }

      const box = drawnBox.value;
      if (box) {
        const [x, y] = [Math.min(box.x1, box.x2), Math.min(box.y1, box.y2)];
        const [w, h] = [Math.abs(box.x2 - box.x1), Math.abs(box.y2 - box.y1)];
        ctx.fillStyle = COLORS.boxFill;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = COLORS.box;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }
    }

    // ---- interaction ------------------------------------------------------

    let gesture: Gesture = null;
    let dragMoved = false;
    let last = { x: 0, y: 0 };

    function localPoint(event: MouseEvent) {
      const rect = canvas.value?.getBoundingClientRect();
      return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    }

    function hitAt(x: number, y: number) {
      return pick(projected.value, x, y, halfSize.value, shapeOf);
    }

    function onMouseDown(event: MouseEvent) {
      if (event.button === 1) {
        // Keep the browser from starting its own middle-button scroll
        event.preventDefault();
        gesture = 'pan';
      } else if (event.button === 0) {
        gesture = boxTool.value || event.shiftKey ? 'box' : 'orbit';
      } else {
        return;
      }
      dragMoved = false;
      last = { x: event.clientX, y: event.clientY };
      if (gesture === 'box') {
        const { x, y } = localPoint(event);
        drawnBox.value = {
          x1: x, y1: y, x2: x, y2: y,
        };
      }
    }

    function onMouseMove(event: MouseEvent) {
      cursor.value = localPoint(event);
      if (gesture) {
        const dx = event.clientX - last.x;
        const dy = event.clientY - last.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
        last = { x: event.clientX, y: event.clientY };
        if (gesture === 'pan') {
          orbit.value = orbitPan(orbit.value, dx, dy);
        } else if (gesture === 'orbit') {
          orbit.value = orbitDrag(orbit.value, dx, dy);
        } else if (drawnBox.value) {
          drawnBox.value = { ...drawnBox.value, x2: cursor.value.x, y2: cursor.value.y };
        }
        return;
      }
      hovered.value = hitAt(cursor.value.x, cursor.value.y)?.key ?? null;
    }

    function onMouseUp(event: MouseEvent) {
      const finished = gesture;
      const box = drawnBox.value;
      gesture = null;
      drawnBox.value = null;
      if (!finished || finished === 'pan') return;
      if (finished === 'box' && box && dragMoved) {
        selected.value = pickInBox(projected.value, box, halfSize.value, shapeOf);
        return;
      }
      if (dragMoved) return;
      const { x, y } = localPoint(event);
      const hit = hitAt(x, y)?.key ?? null;
      if (event.shiftKey && hit) {
        // Shift adds to, or takes from, what is already selected
        selected.value = selectedSet.value.has(hit)
          ? selected.value.filter((key) => key !== hit) : [...selected.value, hit];
      } else {
        selected.value = hit ? [hit] : [];
      }
    }

    function onMouseLeave() {
      hovered.value = null;
      gesture = null;
      drawnBox.value = null;
    }

    function onDoubleClick(event: MouseEvent) {
      const { x, y } = localPoint(event);
      const hit = hitAt(x, y);
      if (hit) emit('open', hit.key);
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      orbit.value = orbitZoom(orbit.value, event.deltaY);
    }

    /** Back to the opening view: the query centered, at the opening angle and zoom. */
    function resetView() {
      orbit.value = { ...DEFAULT_ORBIT };
    }

    const selectedCells = computed(() => selected.value
      .map((key) => cellsByKey.value.get(key))
      .filter((cell): cell is SpaceCell => cell !== undefined));
    /** The type the selection shares, or none when it is mixed. */
    const selectedType = computed(() => {
      const types = new Set(selectedCells.value.map((cell) => cell.type));
      return types.size === 1 ? [...types][0] : '';
    });
    const selectedAdopted = computed(() => selectedCells.value.filter((cell) => cell.adopted));
    /** Whether every selected result already carries this mark. */
    function allMarked(adjudication: Adjudication) {
      return selectedCells.value.length > 0
        && selectedCells.value.every((cell) => cell.adjudication === adjudication);
    }
    function markSelected(adjudication: Adjudication) {
      emit('mark', selectedCells.value.map((cell) => cell.key), adjudication);
    }
    function assignSelected(type: string) {
      emit('assign', selectedCells.value.map((cell) => cell.key), type);
    }
    function removeSelected() {
      emit('remove', selectedAdopted.value.map((cell) => cell.key));
      selected.value = [];
    }

    const selectedCell = computed(() => (selectedCells.value.length === 1
      ? selectedCells.value[0] : null));
    const hoveredCell = computed(() => (hovered.value && !selectedSet.value.has(hovered.value)
      ? cellsByKey.value.get(hovered.value) ?? null : null));
    const tooltipStyle = computed(() => ({
      left: `${Math.min(cursor.value.x + 14, Math.max(0, size.value.width - 220))}px`,
      top: `${Math.min(cursor.value.y + 14, Math.max(0, size.value.height - 60))}px`,
    }));

    watch([
      orbit, hovered, selected, drawnBox, normalized, () => props.cells, () => props.exemplarUrl,
    ], () => requestDraw(), { deep: true });
    watch(spin, (on) => {
      lastTick = 0;
      if (on) requestDraw();
    });
    watch(() => props.points, () => {
      const placed = new Set(props.points.map((p) => p.key));
      if (selected.value.some((key) => !placed.has(key))) {
        selected.value = selected.value.filter((key) => placed.has(key));
      }
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
      boxTool,
      selected,
      selectedCell,
      selectedCells,
      selectedType,
      selectedAdopted,
      allMarked,
      markSelected,
      assignSelected,
      removeSelected,
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
      :class="{ 'results-space-hover': hoveredCell, 'results-space-box': boxTool }"
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
        title="Reset the view: center the query and undo any turn, slide or zoom"
        @click="resetView"
      >
        <v-icon small>
          mdi-image-filter-center-focus
        </v-icon>
      </v-btn>
      <v-btn
        icon
        small
        :color="boxTool ? 'primary' : undefined"
        title="Draw a box to select every result it touches (or hold shift and drag)"
        @click="boxTool = !boxTool"
      >
        <v-icon small>
          mdi-select-drag
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
      v-if="selectedCells.length"
      class="results-space-selected pa-2"
      outlined
    >
      <div class="d-flex align-center">
        <img
          v-if="selectedCell && selectedCell.chip"
          :src="selectedCell.chip"
          class="results-space-selected-chip mr-2"
        >
        <div
          v-if="selectedCell"
          class="text-caption flex-grow-1"
        >
          <div>#{{ selectedCell.rank }} · {{ selectedCell.subtitle }}</div>
          <div class="grey--text">
            score {{ selectedCell.score.toFixed(3) }} · distance {{ selectedCell.distance.toFixed(2) }}
          </div>
        </div>
        <div
          v-else
          class="text-body-2 flex-grow-1"
        >
          {{ selectedCells.length }} results selected
        </div>
        <v-btn
          icon
          small
          title="Clear the selection"
          @click="selected = []"
        >
          <v-icon small>
            mdi-close
          </v-icon>
        </v-btn>
      </div>
      <div class="d-flex align-center mt-1">
        <v-btn
          icon
          small
          color="success"
          :title="selectedCell ? 'Mark as a correct match' : 'Mark all as correct matches'"
          @click="markSelected('positive')"
        >
          <v-icon>
            {{ allMarked('positive') ? 'mdi-check-circle' : 'mdi-check-circle-outline' }}
          </v-icon>
        </v-btn>
        <v-btn
          icon
          small
          color="error"
          :title="selectedCell ? 'Mark as an incorrect match' : 'Mark all as incorrect matches'"
          @click="markSelected('negative')"
        >
          <v-icon>
            {{ allMarked('negative') ? 'mdi-close-circle' : 'mdi-close-circle-outline' }}
          </v-icon>
        </v-btn>
        <v-btn
          v-if="selectedAdopted.length"
          icon
          small
          :title="selectedCell
            ? 'Delete this annotation' : `Delete ${selectedAdopted.length} annotations`"
          @click="removeSelected"
        >
          <v-icon color="red lighten-1">
            mdi-delete-outline
          </v-icon>
        </v-btn>
        <v-spacer />
        <v-btn
          v-if="selectedCell"
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
      <div
        v-if="editable"
        class="d-flex align-center mt-1"
      >
        <span class="text-caption grey--text mr-2">Type</span>
        <ReviewTypeField
          class="flex-grow-1"
          :value="selectedType"
          :options="typeOptions"
          @commit="assignSelected"
        />
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
.results-space-canvas.results-space-box {
  cursor: crosshair;
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
