<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, PropType, ref, watch,
} from 'vue';

/**
 * One grid entry: the cropped chip (cycling through a track's sampled
 * frames once they load) with the annotation's type editable underneath.
 * Presentation-only; the page supplies the images and applies edits, so
 * other item sources (e.g. search results) can reuse it with their own
 * actions through the `actions` slot.
 */
export default defineComponent({
  name: 'ReviewCell',
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
    /** Types offered by the datalist. */
    typeListId: {
      type: String,
      default: 'reviewTypeOptions',
    },
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
    /** Frames in the track, shown as a badge when animated. */
    frameCount: {
      type: Number,
      default: 1,
    },
    editable: {
      type: Boolean,
      default: true,
    },
    /** Attribute mode: what matched, shown in place of nothing. */
    attributeText: {
      type: String,
      default: '',
    },
  },
  setup(props, { emit }) {
    const cycleIndex = ref(0);
    const typeInput = ref(props.type);
    let timer: number | null = null;

    const hasSequence = computed(() => Boolean(props.srcs && props.srcs.length > 1));

    const displaySrc = computed(() => {
      if (hasSequence.value && props.animate) {
        return props.srcs?.[cycleIndex.value] ?? props.src;
      }
      return props.src;
    });

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
      const shouldRun = props.animate && hasSequence.value;
      if (shouldRun && timer === null) {
        timer = window.setInterval(advance, props.cycleIntervalMs);
      } else if (!shouldRun && timer !== null) {
        window.clearInterval(timer);
        timer = null;
        cycleIndex.value = 0;
      }
    }
    watch([() => props.animate, () => props.srcs, () => props.cycleIntervalMs], () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      syncTimer();
    }, { immediate: true });
    onBeforeUnmount(() => {
      if (timer !== null) window.clearInterval(timer);
    });

    watch(() => props.type, (next) => { typeInput.value = next; });

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

    const confidenceText = computed(() => (
      props.confidence === null ? '' : `${Math.round(props.confidence * 100)}%`
    ));

    return {
      displaySrc,
      hasSequence,
      frameLabel,
      typeInput,
      commitType,
      onTypeKeydown,
      confidenceText,
    };
  },
});
</script>

<template>
  <div
    class="review-cell"
    :class="{ 'cell-pending': pending }"
  >
    <div
      class="cell-image-wrap"
      :title="title"
      @click="$emit('open')"
    >
      <img
        v-if="displaySrc"
        :src="displaySrc"
        class="cell-image"
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
      <div
        v-if="confidenceText"
        class="cell-badge cell-confidence text-caption"
      >
        {{ confidenceText }}
      </div>
      <div
        v-if="hasSequence"
        class="cell-badge cell-sequence text-caption"
      >
        <v-icon
          x-small
          color="grey lighten-1"
          class="mr-1"
        >
          mdi-filmstrip
        </v-icon>{{ frameLabel }}
      </div>
      <div
        v-else-if="frameCount > 1"
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
        v-if="pending"
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
                x-small
                class="cell-action"
                :disabled="!editable || !type"
                v-on="on"
                @click.stop="$emit('accept')"
              >
                <v-icon
                  small
                  :color="confidence !== null && confidence >= 1 ? 'success' : 'grey lighten-1'"
                >
                  mdi-check-circle-outline
                </v-icon>
              </v-btn>
            </template>
            <span>Mark this type as correct (confidence 1)</span>
          </v-tooltip>
          <v-tooltip
            bottom
            open-delay="600"
          >
            <template #activator="{ on }">
              <v-btn
                icon
                x-small
                class="cell-action"
                v-on="on"
                @click.stop="$emit('open')"
              >
                <v-icon
                  small
                  color="grey lighten-1"
                >
                  mdi-open-in-new
                </v-icon>
              </v-btn>
            </template>
            <span>Open in the annotation viewer</span>
          </v-tooltip>
        </slot>
      </div>
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
          class="text-caption grey--text cell-caption-line"
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
}

.cell-image-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 32px;
  background: #101010;
  cursor: pointer;
}

.cell-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
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

.cell-pending-badge {
  bottom: 3px;
  left: 3px;
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

.cell-footer {
  flex: 0 0 auto;
  padding: 3px 4px;
  min-width: 0;
}

.cell-type-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 1px 4px;
  font-size: 12px;
  line-height: 18px;
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
  line-height: 1.2;
}
</style>
