<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, PropType, ref, watch,
} from 'vue';
import type { RectBounds } from 'vue-media-annotator/utils';
import { ChipTransform, toChipPoint, toImagePoint } from 'dive-common/review/chipRenderer';
import type { ReviewFrameRef, ReviewPolygon } from 'dive-common/review/types';

/** Geometry of one frame while it is being edited, in image coordinates. */
interface GeometryDraft {
  bounds: RectBounds;
  polygons: ReviewPolygon[];
  head: [number, number] | null;
  tail: [number, number] | null;
}

/** What is emitted when an edit is applied. */
/** Zoom about the chip's origin plus a pan, in chip pixels. */
export interface ChipView {
  scale: number;
  x: number;
  y: number;
}

export interface ReviewChipGeometryEdit {
  /** Sequence slot edited (0 is the primary frame). */
  slot: number;
  frame: number;
  bounds: RectBounds;
  polygons: ReviewPolygon[];
  head: [number, number] | null;
  tail: [number, number] | null;
}

type BoxHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

type DragTarget =
  | { kind: 'box'; handle: BoxHandle }
  | { kind: 'vertex'; polygon: number; vertex: number }
  | { kind: 'point'; key: 'head' | 'tail' };

const BOX_HANDLES: { handle: BoxHandle; cursor: string }[] = [
  { handle: 'nw', cursor: 'nwse-resize' },
  { handle: 'n', cursor: 'ns-resize' },
  { handle: 'ne', cursor: 'nesw-resize' },
  { handle: 'e', cursor: 'ew-resize' },
  { handle: 'se', cursor: 'nwse-resize' },
  { handle: 's', cursor: 'ns-resize' },
  { handle: 'sw', cursor: 'nesw-resize' },
  { handle: 'w', cursor: 'ew-resize' },
];

/**
 * One cropped chip of a grid entry, cycling through a track's sampled
 * frames once they load. Polygons and head/tail points are drawn over it,
 * and a right click opens the frame's box, polygon vertices and points for
 * dragging in place. The wheel zooms and dragging pans at any time. A cell
 * holds one chip per camera the track appears in.
 */
export default defineComponent({
  name: 'ReviewChip',
  props: {
    /** Primary chip data URL, null while loading. */
    src: {
      type: String as PropType<string | null>,
      default: null,
    },
    /** Sampled track frames to cycle through; null slots are still loading. */
    srcs: {
      type: Array as PropType<(string | null)[] | null>,
      default: null,
    },
    /** How the primary chip maps to the frame, once rendered. */
    transform: {
      type: Object as PropType<ChipTransform | null>,
      default: null,
    },
    /** Per-slot transforms of the sampled frames. */
    transforms: {
      type: Array as PropType<(ChipTransform | null)[] | null>,
      default: null,
    },
    /** The frames shown, primary first, with their boxes and geometry. */
    frames: {
      type: Array as PropType<ReviewFrameRef[]>,
      default: () => [],
    },
    animate: {
      type: Boolean,
      default: true,
    },
    cycleIntervalMs: {
      type: Number,
      default: 400,
    },
    /** Why the chip could not be rendered, or null. */
    failure: {
      type: String as PropType<string | null>,
      default: null,
    },
    /** Live type of the annotation. */
    type: {
      type: String,
      default: '',
    },
    /** Confidence of the shown pair; null hides the badge. */
    confidence: {
      type: Number as PropType<number | null>,
      default: null,
    },
    /** Accessible name for the entry (not shown as a tooltip). */
    title: {
      type: String,
      default: '',
    },
    /** Edited but not yet saved. */
    pending: {
      type: Boolean,
      default: false,
    },
    /** Frames in the track, shown as a badge when animated. */
    frameCount: {
      type: Number,
      default: 1,
    },
    editable: {
      type: Boolean,
      default: true,
    },
    /** Camera name shown on the chip when an entry spans several cameras. */
    label: {
      type: String,
      default: '',
    },
    /** Offer a delete action next to the accept action. */
    deletable: {
      type: Boolean,
      default: true,
    },
    /**
     * Sequence slot chosen by the cell, so the cameras of an entry stay on
     * the same frame; null lets the chip cycle on its own.
     */
    controlledSlot: {
      type: Number as PropType<number | null>,
      default: null,
    },
    controlledPaused: {
      type: Boolean,
      default: false,
    },
    /**
     * Zoom and pan chosen by the cell, so the cameras of an entry zoom
     * together; null lets the chip keep its own.
     */
    controlledView: {
      type: Object as PropType<ChipView | null>,
      default: null,
    },
    /** Draw polygons and head/tail points over the chip. */
    showGeometry: {
      type: Boolean,
      default: true,
    },
    /** The annotation type's colour, used for the editing handles like the annotator. */
    color: {
      type: String,
      default: '#00e5ff',
    },
  },
  setup(props, { emit }) {
    const cycleIndex = ref(0);
    const overlay = ref<SVGSVGElement | null>(null);
    const editing = ref(false);
    const draft = ref<GeometryDraft | null>(null);
    /** Cycling stopped by the user stepping through frames. */
    const paused = ref(false);
    /** Handle being dragged, drawn highlighted like the annotator's selected handle. */
    const activeHandle = ref<string | null>(null);
    /** The chip's own zoom and pan, used unless the cell controls the view. */
    const ownView = ref<ChipView>({ scale: 1, x: 0, y: 0 });
    const view = computed<ChipView>(() => props.controlledView ?? ownView.value);
    const wrap = ref<HTMLElement | null>(null);
    let pan: {
      startX: number; startY: number; originX: number; originY: number; pointerId: number; capture: Element | null;
    } | null = null;
    let timer: number | null = null;
    let drag: { target: DragTarget; startImage: [number, number]; startDraft: GeometryDraft } | null = null;

    const hasSequence = computed(() => Boolean(props.srcs && props.srcs.length > 1));
    const controlled = computed(() => props.controlledSlot !== null);

    watch(() => props.controlledSlot, (slot) => {
      if (slot !== null) cycleIndex.value = Math.max(0, slot);
    }, { immediate: true });

    /** Sequence slot on screen; 0 while only the primary chip is available. */
    const currentSlot = computed(() => (hasSequence.value && props.animate ? cycleIndex.value : 0));

    const displaySrc = computed(() => {
      if (hasSequence.value && props.animate) {
        return props.srcs?.[cycleIndex.value] ?? props.src;
      }
      return props.src;
    });

    /** Transform of the chip on screen (the primary's when a slot is still loading). */
    const displayTransform = computed<ChipTransform | null>(() => {
      if (hasSequence.value && props.animate) {
        const slotSrc = props.srcs?.[cycleIndex.value];
        if (slotSrc) return props.transforms?.[cycleIndex.value] ?? null;
      }
      return props.transform;
    });

    const currentFrame = computed<ReviewFrameRef | null>(() => (
      props.frames[currentSlot.value] ?? props.frames[0] ?? null
    ));

    /** This camera has no detection on the frame shown; only an interpolated crop. */
    const missing = computed(() => Boolean(currentFrame.value?.missing));

    /** Which sampled frame is showing, for the badge. */
    const frameLabel = computed(() => {
      if (!hasSequence.value || !props.srcs) return '';
      return `${cycleIndex.value + 1}/${props.srcs.length}`;
    });

    function advance() {
      const srcs = props.srcs ?? [];
      for (let step = 1; step <= srcs.length; step += 1) {
        const next = (cycleIndex.value + step) % srcs.length;
        if (srcs[next]) {
          cycleIndex.value = next;
          return;
        }
      }
    }

    function syncTimer() {
      const shouldRun = props.animate && hasSequence.value && !editing.value && !paused.value
        && !controlled.value;
      if (shouldRun && timer === null) {
        timer = window.setInterval(advance, props.cycleIntervalMs);
      } else if (!shouldRun && timer !== null) {
        window.clearInterval(timer);
        timer = null;
        if (!editing.value && !paused.value) cycleIndex.value = 0;
      }
    }
    watch([() => props.animate, () => props.srcs, () => props.cycleIntervalMs, editing, paused], () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      syncTimer();
    }, { immediate: true });
    onBeforeUnmount(() => {
      if (timer !== null) window.clearInterval(timer);
    });

    /** Step to the previous/next loaded frame by hand, pausing the cycling there. */
    function step(direction: 1 | -1) {
      if (controlled.value) {
        emit('step', direction);
        return;
      }
      const srcs = props.srcs ?? [];
      if (srcs.length < 2) return;
      paused.value = true;
      for (let count = 1; count <= srcs.length; count += 1) {
        const next = (cycleIndex.value + direction * count + srcs.length * count) % srcs.length;
        if (srcs[next]) {
          cycleIndex.value = next;
          return;
        }
      }
    }

    function togglePaused() {
      if (controlled.value) {
        emit('toggle-paused');
        return;
      }
      paused.value = !paused.value;
    }

    const shownPaused = computed(() => (controlled.value ? props.controlledPaused : paused.value));

    const confidenceText = computed(() => (
      props.confidence === null ? '' : `${Math.round(props.confidence * 100)}%`
    ));

    // ---- overlay geometry, in chip pixels ---------------------------------

    /** Geometry drawn: the draft while editing, else the frame's own. */
    const shownGeometry = computed<GeometryDraft | null>(() => {
      if (editing.value && draft.value) return draft.value;
      const frame = currentFrame.value;
      if (!frame) return null;
      return {
        bounds: frame.bounds,
        polygons: frame.polygons ?? [],
        head: frame.head ?? null,
        tail: frame.tail ?? null,
      };
    });

    /** The box is always drawn over the chip, so edits show without re-cropping. */
    const overlayVisible = computed(() => (
      Boolean(displayTransform.value) && Boolean(shownGeometry.value)
    ));

    const viewStyle = computed(() => ({
      transform: `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.scale})`,
      transformOrigin: '0 0',
    }));

    const viewBox = computed(() => {
      const t = displayTransform.value;
      return t ? `0 0 ${t.width} ${t.height}` : '0 0 1 1';
    });

    function chip(point: [number, number]): [number, number] {
      const t = displayTransform.value;
      return t ? toChipPoint(t, point[0], point[1]) : point;
    }

    const polygonPoints = computed(() => (shownGeometry.value?.polygons ?? []).map(
      (polygon) => polygon.map((p) => chip(p).map((v) => v.toFixed(1)).join(',')).join(' '),
    ));

    const polygonVertices = computed(() => (shownGeometry.value?.polygons ?? []).map(
      (polygon) => polygon.map((p) => chip(p)),
    ));

    const headPoint = computed(() => (shownGeometry.value?.head ? chip(shownGeometry.value.head) : null));
    const tailPoint = computed(() => (shownGeometry.value?.tail ? chip(shownGeometry.value.tail) : null));

    const boxRect = computed(() => {
      const g = shownGeometry.value;
      if (!g) return null;
      const [x1, y1, x2, y2] = g.bounds;
      const a = chip([Math.min(x1, x2), Math.min(y1, y2)]);
      const b = chip([Math.max(x1, x2), Math.max(y1, y2)]);
      return {
        x: a[0], y: a[1], width: Math.max(0, b[0] - a[0]), height: Math.max(0, b[1] - a[1]),
      };
    });

    /**
     * Stroke and handle sizes in chip pixels, so they look the same at any
     * chip resolution and stay the same on screen as the view zooms.
     */
    const unit = computed(() => {
      const t = displayTransform.value;
      const shown = t ? Math.max(t.width, t.height) : 256;
      return Math.max(1, shown / 180) / view.value.scale;
    });

    /**
     * Box handles as the annotator draws them: circles on the corners
     * (vertex handles) and smaller ones on the edge midpoints.
     */
    const boxHandles = computed(() => {
      const r = boxRect.value;
      if (!r) return [];
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const at: Record<BoxHandle, [number, number]> = {
        move: [cx, cy],
        nw: [r.x, r.y],
        n: [cx, r.y],
        ne: [r.x + r.width, r.y],
        e: [r.x + r.width, cy],
        se: [r.x + r.width, r.y + r.height],
        s: [cx, r.y + r.height],
        sw: [r.x, r.y + r.height],
        w: [r.x, cy],
      };
      return BOX_HANDLES.map(({ handle, cursor }) => ({
        handle,
        cursor,
        x: at[handle][0],
        y: at[handle][1],
        radius: unit.value * (handle.length === 2 ? 3 : 2),
      }));
    });

    function handleFill(id: string) {
      return activeHandle.value === id ? '#ff0000' : props.color;
    }

    function handleOpacity(id: string) {
      return activeHandle.value === id ? 1 : 0.25;
    }

    // ---- editing --------------------------------------------------------------

    function cloneDraft(g: GeometryDraft): GeometryDraft {
      return {
        bounds: [...g.bounds] as RectBounds,
        polygons: g.polygons.map((polygon) => polygon.map((p) => [p[0], p[1]] as [number, number])),
        head: g.head ? [g.head[0], g.head[1]] : null,
        tail: g.tail ? [g.tail[0], g.tail[1]] : null,
      };
    }

    /** Turn the interpolated position into a real box the user can then adjust. */
    function addBox() {
      const frame = currentFrame.value;
      if (!props.editable || !frame || !frame.missing) return;
      emit('add-box', { frame: frame.frame, bounds: frame.bounds });
    }

    function beginEdit(event: MouseEvent) {
      event.preventDefault();
      if (!props.editable || !displayTransform.value || !shownGeometry.value || editing.value) return;
      if (missing.value) {
        addBox();
        return;
      }
      draft.value = cloneDraft(shownGeometry.value);
      editing.value = true;
      // Editing pins the frame; cycling stays paused afterwards until resumed.
      paused.value = true;
      if (controlled.value) emit('pause');
      emit('edit-start');
      requestAnimationFrame(() => overlay.value?.focus());
    }

    // ---- zoom and pan ----------------------------------------------------

    const MIN_ZOOM = 1;
    const MAX_ZOOM = 16;

    function setView(next: ChipView) {
      if (props.controlledView) emit('view-change', next);
      else ownView.value = next;
    }

    /** Wheel zooms about the cursor, like the annotator's map, whether editing or not. */
    function onWheel(event: WheelEvent) {
      if (!wrap.value || !displaySrc.value) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = wrap.value.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const current = view.value;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale * Math.exp(-event.deltaY * 0.0015)));
      if (next === current.scale) return;
      if (next <= MIN_ZOOM) {
        setView({ scale: 1, x: 0, y: 0 });
        return;
      }
      const ratio = next / current.scale;
      setView({
        scale: next,
        x: px - (px - current.x) * ratio,
        y: py - (py - current.y) * ratio,
      });
    }

    /** Drag on the zoomed image (empty overlay space while editing) pans the view. */
    function startPan(event: PointerEvent) {
      // Left button on the image, or the middle button anywhere.
      if ((event.button !== 0 && event.button !== 1) || view.value.scale <= MIN_ZOOM) return;
      if (event.button === 1) event.preventDefault();
      const capture = event.currentTarget as Element | null;
      pan = {
        startX: event.clientX,
        startY: event.clientY,
        originX: view.value.x,
        originY: view.value.y,
        pointerId: event.pointerId,
        capture,
      };
      capture?.setPointerCapture(event.pointerId);
    }

    function onPanMove(event: PointerEvent) {
      if (!pan) return;
      setView({
        scale: view.value.scale,
        x: pan.originX + (event.clientX - pan.startX),
        y: pan.originY + (event.clientY - pan.startY),
      });
    }

    function endPan(event: PointerEvent) {
      if (!pan) return;
      const { capture } = pan;
      pan = null;
      try {
        capture?.releasePointerCapture(event.pointerId);
      } catch {
        // Capture may already be gone.
      }
    }

    /**
     * Outside editing there is no overlay, so the wrap pans the image itself.
     * Only the image starts a pan, so the action buttons keep their clicks.
     */
    function onWrapPointerDown(event: PointerEvent) {
      if (editing.value) return;
      const target = event.target as Element | null;
      if (event.button === 0 && !target?.classList.contains('cell-image')) return;
      startPan(event);
    }

    /** The middle button pans; keep the browser's autoscroll out of it. */
    function onWrapMouseDown(event: MouseEvent) {
      if (event.button === 1) event.preventDefault();
    }

    function onWrapPointerMove(event: PointerEvent) {
      if (!editing.value) onPanMove(event);
    }

    function onWrapPointerUp(event: PointerEvent) {
      if (!editing.value) endPan(event);
    }

    function cancelEdit() {
      editing.value = false;
      draft.value = null;
      drag = null;
      emit('edit-end');
    }

    function applyEdit() {
      const frame = currentFrame.value;
      const original: GeometryDraft | null = frame ? {
        bounds: frame.bounds,
        polygons: frame.polygons ?? [],
        head: frame.head ?? null,
        tail: frame.tail ?? null,
      } : null;
      const changed = draft.value && original
        && JSON.stringify(draft.value) !== JSON.stringify(original);
      if (editing.value && draft.value && frame && changed) {
        const edit: ReviewChipGeometryEdit = {
          slot: currentSlot.value,
          frame: frame.frame,
          bounds: draft.value.bounds,
          polygons: draft.value.polygons,
          head: draft.value.head,
          tail: draft.value.tail,
        };
        emit('edit-geometry', edit);
      }
      cancelEdit();
    }

    function imagePointFromEvent(event: PointerEvent): [number, number] | null {
      const svg = overlay.value;
      const t = displayTransform.value;
      if (!svg || !t) return null;
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      return toImagePoint(t, point.x, point.y);
    }

    function handleId(target: DragTarget): string {
      if (target.kind === 'box') return `box-${target.handle}`;
      if (target.kind === 'vertex') return `v-${target.polygon}-${target.vertex}`;
      return target.key;
    }

    function startDrag(target: DragTarget, event: PointerEvent) {
      if (!editing.value || !draft.value || event.button !== 0) return;
      const start = imagePointFromEvent(event);
      if (!start) return;
      event.preventDefault();
      event.stopPropagation();
      drag = { target, startImage: start, startDraft: cloneDraft(draft.value) };
      activeHandle.value = handleId(target);
      overlay.value?.setPointerCapture(event.pointerId);
    }

    function moveBox(handle: BoxHandle, from: RectBounds, dx: number, dy: number): RectBounds {
      let [x1, y1, x2, y2] = from;
      if (handle === 'move') {
        return [x1 + dx, y1 + dy, x2 + dx, y2 + dy];
      }
      if (handle.includes('w')) x1 += dx;
      if (handle.includes('e')) x2 += dx;
      if (handle.includes('n')) y1 += dy;
      if (handle.includes('s')) y2 += dy;
      return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    }

    function onPointerMove(event: PointerEvent) {
      if (pan) {
        onPanMove(event);
        return;
      }
      if (!drag || !draft.value) return;
      const current = imagePointFromEvent(event);
      if (!current) return;
      const dx = current[0] - drag.startImage[0];
      const dy = current[1] - drag.startImage[1];
      const { target, startDraft } = drag;
      if (target.kind === 'box') {
        draft.value.bounds = moveBox(target.handle, startDraft.bounds, dx, dy);
      } else if (target.kind === 'vertex') {
        const origin = startDraft.polygons[target.polygon]?.[target.vertex];
        if (origin) {
          // Replace the arrays: index assignment is invisible to Vue 2.
          const polygons = startDraft.polygons.map((polygon) => polygon.map((p) => [p[0], p[1]] as [number, number]));
          polygons[target.polygon][target.vertex] = [origin[0] + dx, origin[1] + dy];
          draft.value.polygons = polygons;
        }
      } else {
        const origin = startDraft[target.key];
        if (origin) draft.value[target.key] = [origin[0] + dx, origin[1] + dy];
      }
    }

    function endDrag(event: PointerEvent) {
      if (pan) {
        endPan(event);
        return;
      }
      if (!drag) return;
      drag = null;
      activeHandle.value = null;
      try {
        overlay.value?.releasePointerCapture(event.pointerId);
      } catch {
        // Capture may already be gone.
      }
    }

    function onOverlayKeydown(event: KeyboardEvent) {
      if (!editing.value) return;
      if (event.key === 'Escape') {
        cancelEdit();
      } else if (event.key === 'Enter') {
        applyEdit();
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    }

    /** Double click opens the viewer; a single click is left alone so edits are not lost to a slip. */
    function onImageDoubleClick() {
      if (editing.value) return;
      emit('open', currentFrame.value?.frame);
    }

    /** Right click: start editing, or, while editing, lock the changes in like the annotator. */
    function onContextMenu(event: MouseEvent) {
      event.preventDefault();
      if (editing.value) {
        applyEdit();
      } else {
        beginEdit(event);
      }
    }

    return {
      displaySrc,
      hasSequence,
      frameLabel,
      confidenceText,
      overlay,
      overlayVisible,
      viewBox,
      polygonPoints,
      polygonVertices,
      headPoint,
      tailPoint,
      boxRect,
      boxHandles,
      unit,
      editing,
      beginEdit,
      cancelEdit,
      applyEdit,
      startDrag,
      onPointerMove,
      endDrag,
      onOverlayKeydown,
      onImageDoubleClick,
      onContextMenu,
      currentFrame,
      paused: shownPaused,
      step,
      togglePaused,
      handleFill,
      handleOpacity,
      activeHandle,
      wrap,
      viewStyle,
      onWheel,
      startPan,
      zoomed: computed(() => view.value.scale > 1),
      onWrapPointerDown,
      onWrapMouseDown,
      onWrapPointerMove,
      onWrapPointerUp,
      missing,
      addBox,
    };
  },
});
</script>

<template>
  <div
    ref="wrap"
    class="cell-image-wrap"
    :class="{ 'chip-editing': editing }"
    :aria-label="title"
    @dblclick="onImageDoubleClick"
    @contextmenu="onContextMenu"
    @wheel="onWheel"
    @mousedown="onWrapMouseDown"
    @pointerdown="onWrapPointerDown"
    @pointermove="onWrapPointerMove"
    @pointerup="onWrapPointerUp"
    @pointercancel="onWrapPointerUp"
  >
    <img
      v-if="displaySrc"
      :src="displaySrc"
      class="cell-image"
      :class="{ 'cell-image-zoomed': zoomed }"
      :style="viewStyle"
      draggable="false"
    >
    <div
      v-else-if="failure"
      class="cell-image cell-placeholder d-flex flex-column align-center justify-center"
      :title="failure"
    >
      <v-icon color="grey darken-1">
        mdi-image-off-outline
      </v-icon>
      <span class="text-caption grey--text text-truncate px-2 failure-text">{{ failure }}</span>
    </div>
    <div
      v-else
      class="cell-image cell-placeholder d-flex align-center justify-center"
    >
      <v-progress-circular
        indeterminate
        size="20"
        width="2"
        color="grey"
      />
    </div>
    <svg
      v-if="displaySrc && overlayVisible"
      ref="overlay"
      class="cell-image cell-overlay"
      :class="{ 'overlay-editing': editing }"
      :viewBox="viewBox"
      :style="viewStyle"
      preserveAspectRatio="xMidYMid meet"
      tabindex="-1"
      @keydown="onOverlayKeydown"
      @pointerdown="startPan"
      @pointermove="onPointerMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
    >
      <rect
        v-if="!editing && boxRect && !missing"
        :x="boxRect.x"
        :y="boxRect.y"
        :width="boxRect.width"
        :height="boxRect.height"
        class="overlay-box-static"
        :stroke="color"
        :stroke-width="unit * 1.5"
      />
      <polygon
        v-for="(points, index) in polygonPoints"
        :key="`poly-${index}`"
        :points="points"
        class="overlay-polygon"
        :stroke-width="unit"
      />
      <line
        v-if="headPoint && tailPoint"
        :x1="headPoint[0]"
        :y1="headPoint[1]"
        :x2="tailPoint[0]"
        :y2="tailPoint[1]"
        class="overlay-headtail-line"
        :stroke-width="unit"
      />
      <template v-if="editing && boxRect">
        <rect
          :x="boxRect.x"
          :y="boxRect.y"
          :width="boxRect.width"
          :height="boxRect.height"
          class="overlay-box"
          :stroke="color"
          :stroke-width="unit * 1.5"
          @pointerdown="startDrag({ kind: 'box', handle: 'move' }, $event)"
        />
        <circle
          v-for="handle in boxHandles"
          :key="handle.handle"
          :cx="handle.x"
          :cy="handle.y"
          :r="handle.radius"
          class="overlay-handle"
          :style="{ cursor: handle.cursor }"
          :fill="handleFill(`box-${handle.handle}`)"
          :fill-opacity="handleOpacity(`box-${handle.handle}`)"
          :stroke="handleFill(`box-${handle.handle}`)"
          :stroke-width="unit * 0.6"
          @pointerdown="startDrag({ kind: 'box', handle: handle.handle }, $event)"
        />
        <template v-for="(vertices, polygonIndex) in polygonVertices">
          <circle
            v-for="(vertex, vertexIndex) in vertices"
            :key="`v-${polygonIndex}-${vertexIndex}`"
            :cx="vertex[0]"
            :cy="vertex[1]"
            :r="unit * 3"
            class="overlay-vertex"
            :fill="handleFill(`v-${polygonIndex}-${vertexIndex}`)"
            :fill-opacity="handleOpacity(`v-${polygonIndex}-${vertexIndex}`)"
            :stroke="handleFill(`v-${polygonIndex}-${vertexIndex}`)"
            :stroke-width="unit * 0.6"
            @pointerdown="startDrag({ kind: 'vertex', polygon: polygonIndex, vertex: vertexIndex }, $event)"
          />
        </template>
      </template>
      <circle
        v-if="headPoint"
        :cx="headPoint[0]"
        :cy="headPoint[1]"
        :r="unit * (editing ? 3.5 : 2.5)"
        class="overlay-head"
        :stroke-width="unit"
        @pointerdown="startDrag({ kind: 'point', key: 'head' }, $event)"
      />
      <circle
        v-if="tailPoint"
        :cx="tailPoint[0]"
        :cy="tailPoint[1]"
        :r="unit * (editing ? 3.5 : 2.5)"
        class="overlay-tail"
        :stroke-width="unit"
        @pointerdown="startDrag({ kind: 'point', key: 'tail' }, $event)"
      />
    </svg>
    <div
      v-if="(confidenceText || label || missing) && !editing"
      class="cell-badge cell-confidence text-caption"
    >
      <span
        v-if="label"
        class="chip-label"
      >{{ label }}</span>{{ confidenceText }}<span
        v-if="missing"
        class="chip-missing"
      >no box</span>
    </div>
    <div
      v-if="hasSequence && !editing"
      class="cell-badge cell-sequence cell-sequence-controls text-caption"
      :class="{ 'cell-sequence-bottom': label }"
      @click.stop
      @dblclick.stop
      @contextmenu.stop.prevent
    >
      <button
        type="button"
        class="sequence-button"
        title="Previous frame (pauses cycling)"
        @click="step(-1)"
      >
        <v-icon x-small>
          mdi-chevron-left
        </v-icon>
      </button>
      <button
        type="button"
        class="sequence-button"
        :title="paused ? 'Resume cycling' : 'Pause cycling'"
        @click="togglePaused"
      >
        <v-icon x-small>
          {{ paused ? 'mdi-play' : 'mdi-pause' }}
        </v-icon>
      </button>
      <span class="sequence-label">{{ frameLabel }}</span>
      <button
        type="button"
        class="sequence-button"
        title="Next frame (pauses cycling)"
        @click="step(1)"
      >
        <v-icon x-small>
          mdi-chevron-right
        </v-icon>
      </button>
    </div>
    <div
      v-else-if="frameCount > 1 && !editing"
      class="cell-badge cell-sequence text-caption"
      title="Loading track frames"
    >
      <v-icon
        x-small
        color="grey lighten-1"
      >
        mdi-filmstrip
      </v-icon>
    </div>
    <div
      v-if="pending && !editing && !label"
      class="cell-badge cell-pending-badge text-caption"
      title="Changed; not saved yet"
    >
      <v-icon
        x-small
        color="amber"
      >
        mdi-pencil
      </v-icon>
    </div>
    <div
      v-if="editing"
      class="cell-edit-bar"
      @click.stop
      @contextmenu.stop.prevent
    >
      <span class="text-caption edit-hint">
        Frame {{ currentFrame ? currentFrame.frame : '' }}: drag to adjust, wheel to zoom, middle drag to pan, right click to keep
      </span>
      <v-btn
        x-small
        depressed
        color="primary"
        class="ml-1"
        title="Apply (Enter)"
        @click="applyEdit"
      >
        Apply
      </v-btn>
      <v-btn
        x-small
        text
        class="ml-1"
        title="Cancel (Esc)"
        @click="cancelEdit"
      >
        Cancel
      </v-btn>
    </div>
    <div
      v-if="!editing"
      class="cell-actions"
      @click.stop
    >
      <slot name="actions">
        <v-tooltip
          bottom
          open-delay="600"
        >
          <template #activator="{ on }">
            <v-btn
              icon
              small
              class="cell-action"
              :disabled="!editable || !type"
              v-on="on"
              @click.stop="$emit('accept')"
            >
              <v-icon
                :color="confidence !== null && confidence >= 1 ? 'success' : 'grey lighten-1'"
              >
                mdi-check-circle-outline
              </v-icon>
            </v-btn>
          </template>
          <span>Mark this type as correct (confidence 1)</span>
        </v-tooltip>
        <v-tooltip
          v-if="deletable"
          bottom
          open-delay="600"
        >
          <template #activator="{ on }">
            <v-btn
              icon
              small
              class="cell-action"
              :disabled="!editable"
              v-on="on"
              @click.stop="$emit('delete')"
            >
              <v-icon color="red lighten-1">
                mdi-close-circle-outline
              </v-icon>
            </v-btn>
          </template>
          <span>Delete this annotation</span>
        </v-tooltip>
        <v-tooltip
          v-if="missing"
          bottom
          open-delay="600"
        >
          <template #activator="{ on }">
            <v-btn
              icon
              small
              class="cell-action"
              :disabled="!editable"
              v-on="on"
              @click.stop="addBox"
            >
              <v-icon color="grey lighten-1">
                mdi-vector-square-plus
              </v-icon>
            </v-btn>
          </template>
          <span>No detection on this frame here: add a box at the interpolated position</span>
        </v-tooltip>
        <v-tooltip
          v-else
          bottom
          open-delay="600"
        >
          <template #activator="{ on }">
            <v-btn
              icon
              small
              class="cell-action"
              :disabled="!editable"
              v-on="on"
              @click.stop="beginEdit($event)"
            >
              <v-icon color="grey lighten-1">
                mdi-vector-square-edit
              </v-icon>
            </v-btn>
          </template>
          <span>Edit this frame's box and geometry (or right click)</span>
        </v-tooltip>
        <v-tooltip
          bottom
          open-delay="600"
        >
          <template #activator="{ on }">
            <v-btn
              icon
              small
              class="cell-action"
              v-on="on"
              @click.stop="$emit('open', currentFrame ? currentFrame.frame : undefined)"
            >
              <v-icon color="grey lighten-1">
                mdi-open-in-new
              </v-icon>
            </v-btn>
          </template>
          <span>Open in the annotation viewer at this frame (or double click)</span>
        </v-tooltip>
      </slot>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.cell-image-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 32px;
  background: #101010;
  cursor: pointer;
  min-width: 0;
  flex: 1 1 0;
}

.cell-image-wrap.chip-editing {
  cursor: default;
}

.cell-image-zoomed {
  cursor: grab;
}

.cell-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}

.cell-overlay {
  pointer-events: none;
  outline: none;
  overflow: visible;

  &.overlay-editing {
    pointer-events: auto;
    touch-action: none;
  }
}

.overlay-polygon {
  fill: rgba(255, 193, 7, 0.12);
  stroke: #ffc107;
  vector-effect: non-scaling-stroke;
}

.overlay-headtail-line {
  stroke: rgba(255, 255, 255, 0.7);
  stroke-dasharray: 4 3;
}

.overlay-head {
  fill: #66bb6a;
  stroke: #fff;
  pointer-events: auto;
}

.overlay-tail {
  fill: #ef5350;
  stroke: #fff;
  pointer-events: auto;
}

.overlay-editing .overlay-head,
.overlay-editing .overlay-tail {
  cursor: grab;
}

.overlay-box {
  fill: rgba(255, 255, 255, 0.04);
  cursor: move;
}

.overlay-box-static {
  fill: none;
}

.overlay-vertex {
  cursor: grab;
}

.cell-placeholder {
  background: #181818;
  cursor: default;
}

.failure-text {
  max-width: 100%;
}

.cell-badge {
  position: absolute;
  padding: 0 5px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  line-height: 18px;
  pointer-events: none;
}

.cell-confidence {
  top: 3px;
  left: 3px;
}

.cell-sequence {
  top: 3px;
  right: 3px;
  display: flex;
  align-items: center;
}

.cell-sequence-controls {
  pointer-events: auto;
  padding: 0 2px;
  gap: 1px;
}

// Narrow camera chips: keep the frame controls clear of the camera label
.cell-sequence-bottom {
  top: auto;
  right: auto;
  bottom: 3px;
  left: 3px;
}

.sequence-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: #ddd;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .v-icon {
    color: #ddd;
  }
}

.sequence-label {
  padding: 0 2px;
  min-width: 26px;
  text-align: center;
}

.cell-pending-badge {
  bottom: 3px;
  left: 3px;
}

.cell-edit-bar {
  position: absolute;
  top: 2px;
  left: 2px;
  right: 2px;
  display: flex;
  align-items: center;
  padding: 2px 4px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.7);
}

.edit-hint {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #ddd;
}

.cell-actions {
  position: absolute;
  right: 2px;
  bottom: 2px;
  display: flex;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  transition: opacity 120ms;
}

.cell-image-wrap:hover .cell-actions {
  opacity: 1;
}

.cell-action {
  transition: transform 100ms;

  &:hover {
    transform: scale(1.25);
  }
}

.chip-label {
  margin-right: 5px;
  color: #90caf9;
  font-weight: 500;
}

.chip-missing {
  margin-left: 5px;
  color: #ffb74d;
}
</style>
