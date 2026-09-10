<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, PropType, ref, watch,
} from 'vue';
import type { ChipTransform } from 'dive-common/review/chipRenderer';
import type { ReviewFrameRef } from 'dive-common/review/types';
import ReviewChip, { ChipView, ReviewChipGeometryEdit } from './ReviewChip.vue';

/** One chip of an entry: a track in one camera. */
export interface ReviewCellView {
  key: string;
  src: string | null;
  srcs: (string | null)[] | null;
  transform: ChipTransform | null;
  transforms: (ChipTransform | null)[] | null;
  frames: ReviewFrameRef[];
  failure: string | null;
  frameCount: number;
  /** Camera name, empty for single-camera entries. */
  label: string;
}

export type ReviewCellGeometryEdit = ReviewChipGeometryEdit;

/**
 * One grid entry: the track's chips (one per camera it appears in, side by
 * side) with the annotation's type editable underneath. Presentation-only;
 * the page supplies the images and applies edits, so other item sources
 * (e.g. search results) can reuse it with their own actions through the
 * `actions` slot. Single-chip users may pass the chip props directly
 * instead of `views`.
 */
export default defineComponent({
  name: 'ReviewCell',
  components: { ReviewChip },
  props: {
    /** Chips of the entry, one per camera. Overrides the single-chip props. */
    views: {
      type: Array as PropType<ReviewCellView[] | null>,
      default: null,
    },
    /** Primary chip data URL, null while loading (single-chip form). */
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
    /** Why the chip could not be rendered, or null. */
    failure: {
      type: String as PropType<string | null>,
      default: null,
    },
    /** Frames in the track, shown as a badge when animated. */
    frameCount: {
      type: Number,
      default: 1,
    },
    animate: {
      type: Boolean,
      default: true,
    },
    cycleIntervalMs: {
      type: Number,
      default: 400,
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
    /** Types offered by the datalist. */
    typeListId: {
      type: String,
      default: 'reviewTypeOptions',
    },
    /** Accessible name for the entry (not shown as a tooltip). */
    title: {
      type: String,
      default: '',
    },
    subtitle: {
      type: String,
      default: '',
    },
    /** Edited but not yet saved. */
    pending: {
      type: Boolean,
      default: false,
    },
    editable: {
      type: Boolean,
      default: true,
    },
    /** Offer the delete action on the chips. */
    deletable: {
      type: Boolean,
      default: true,
    },
    /** Attribute mode: what matched, shown in place of nothing. */
    attributeText: {
      type: String,
      default: '',
    },
    /** Size factor for the footer text, 1 being the base size. */
    scale: {
      type: Number,
      default: 1,
    },
    /** Draw polygons and head/tail points over the chips. */
    showGeometry: {
      type: Boolean,
      default: true,
    },
    /** The annotation type's colour, used for boxes and editing handles. */
    color: {
      type: String,
      default: '#00e5ff',
    },
  },
  setup(props, { emit }) {
    const typeInput = ref(props.type);
    /** Chips currently in edit mode, to outline the whole entry. */
    const editingCount = ref(0);

    const viewList = computed<ReviewCellView[]>(() => props.views ?? [{
      key: 'single',
      src: props.src,
      srcs: props.srcs,
      transform: props.transform,
      transforms: props.transforms,
      frames: props.frames,
      failure: props.failure,
      frameCount: props.frameCount,
      label: '',
    }]);

    watch(() => props.type, (next) => { typeInput.value = next; });

    // ---- shared cycling: every camera of an entry shows the same frame ----

    const shared = computed(() => viewList.value.length > 1);
    const sharedSlot = ref(0);
    const sharedPaused = ref(false);
    /** One zoom and pan for every camera of the entry. */
    const sharedView = ref<ChipView>({ scale: 1, x: 0, y: 0 });
    let timer: number | null = null;

    const sequenceLength = computed(() => (
      viewList.value.reduce((longest, view) => Math.max(longest, view.srcs?.length ?? 0), 0)
    ));

    /** Whether any camera has the frame for a slot, so the cycle never stalls on a gap. */
    function slotLoaded(slot: number) {
      return viewList.value.some((view) => Boolean(view.srcs?.[slot]));
    }

    function advanceShared(direction: 1 | -1 = 1) {
      const length = sequenceLength.value;
      if (length < 2) return;
      for (let count = 1; count <= length; count += 1) {
        const next = (sharedSlot.value + direction * count + length * count) % length;
        if (slotLoaded(next)) {
          sharedSlot.value = next;
          return;
        }
      }
    }

    function syncSharedTimer() {
      const shouldRun = shared.value && props.animate && sequenceLength.value > 1
        && !sharedPaused.value && editingCount.value === 0;
      if (shouldRun && timer === null) {
        timer = window.setInterval(() => advanceShared(1), props.cycleIntervalMs);
      } else if (!shouldRun && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    }
    watch(
      [shared, () => props.animate, sequenceLength, sharedPaused, editingCount, () => props.cycleIntervalMs],
      () => {
        if (timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
        syncSharedTimer();
      },
      { immediate: true },
    );
    onBeforeUnmount(() => {
      if (timer !== null) window.clearInterval(timer);
    });

    function stepShared(direction: 1 | -1) {
      sharedPaused.value = true;
      advanceShared(direction);
    }

    function toggleSharedPaused() {
      sharedPaused.value = !sharedPaused.value;
    }

    function commitType() {
      const next = typeInput.value.trim();
      if (!next) {
        typeInput.value = props.type;
        return;
      }
      if (next !== props.type) emit('assign', next);
    }

    function onTypeKeydown(event: KeyboardEvent) {
      if (event.key === 'Enter') {
        (event.target as HTMLInputElement).blur();
      } else if (event.key === 'Escape') {
        typeInput.value = props.type;
        (event.target as HTMLInputElement).blur();
      }
      // Arrow keys page the grid; keep them inside the field while typing.
      event.stopPropagation();
    }

    return {
      viewList,
      typeInput,
      editingCount,
      commitType,
      onTypeKeydown,
      shared,
      sharedSlot,
      sharedPaused,
      sharedView,
      stepShared,
      toggleSharedPaused,
    };
  },
});
</script>

<template>
  <div
    class="review-cell"
    :class="{ 'cell-pending': pending, 'cell-editing': editingCount > 0 }"
    :style="{ '--cell-scale': scale }"
  >
    <div class="cell-views">
      <ReviewChip
        v-for="(view, index) in viewList"
        :key="view.key"
        :src="view.src"
        :srcs="view.srcs"
        :transform="view.transform"
        :transforms="view.transforms"
        :frames="view.frames"
        :failure="view.failure"
        :frame-count="view.frameCount"
        :label="view.label"
        :animate="animate"
        :cycle-interval-ms="cycleIntervalMs"
        :type="type"
        :confidence="index === 0 ? confidence : null"
        :title="title"
        :pending="pending"
        :editable="editable"
        :deletable="deletable"
        :show-geometry="showGeometry"
        :color="color"
        :controlled-slot="shared ? sharedSlot : null"
        :controlled-paused="sharedPaused"
        :controlled-view="shared ? sharedView : null"
        @view-change="sharedView = $event"
        @step="stepShared"
        @toggle-paused="toggleSharedPaused"
        @pause="sharedPaused = true"
        @accept="$emit('accept')"
        @delete="$emit('delete')"
        @open="$emit('open', $event, index)"
        @edit-geometry="$emit('edit-geometry', $event, index)"
        @add-box="$emit('add-box', $event, index)"
        @edit-start="editingCount += 1"
        @edit-end="editingCount = Math.max(0, editingCount - 1)"
      >
        <template
          v-if="$scopedSlots.actions"
          #actions
        >
          <slot name="actions" />
        </template>
      </ReviewChip>
    </div>
    <div class="cell-footer">
      <slot name="footer">
        <input
          v-model="typeInput"
          type="text"
          class="cell-type-input"
          :list="typeListId"
          :disabled="!editable"
          :title="type"
          spellcheck="false"
          @blur="commitType"
          @keydown="onTypeKeydown"
        >
        <div
          v-if="subtitle || attributeText"
          class="grey--text cell-caption-line"
          :title="attributeText || subtitle"
        >
          {{ attributeText || subtitle }}
        </div>
      </slot>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.review-cell {
  --cell-scale: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  overflow: hidden;
  background: #1e1e1e;

  &.cell-pending {
    border-color: #ffb300;
  }

  &.cell-editing {
    border-color: #90caf9;
  }
}

.cell-views {
  display: flex;
  flex: 1 1 auto;
  min-height: 32px;
  min-width: 0;
  gap: 2px;
  background: #101010;
}

.cell-footer {
  flex: 0 0 auto;
  padding: calc(3px * var(--cell-scale)) calc(4px * var(--cell-scale));
  min-width: 0;
}

.cell-type-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: calc(2px * var(--cell-scale)) calc(5px * var(--cell-scale));
  font-size: calc(13px * var(--cell-scale));
  line-height: calc(19px * var(--cell-scale));
  color: #eee;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 3px;
  outline: none;

  &:focus {
    border-color: #90caf9;
  }

  &:disabled {
    color: #888;
  }
}

.cell-caption-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(11.5px * var(--cell-scale));
  line-height: 1.3;
  margin-top: calc(2px * var(--cell-scale));
}
</style>
