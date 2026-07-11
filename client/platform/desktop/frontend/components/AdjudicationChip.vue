<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, PropType, ref, watch,
} from 'vue';
import type { Adjudication } from 'platform/desktop/frontend/useVideoSearch';

/** Delay between cycling frames of a track sequence. */
const CycleIntervalMs = 400;

/**
 * One adjudicable media snippet: a cropped chip with accept/reject buttons
 * in its bottom-right corner. Presentation-only, so it can back both video
 * search results and (later) annotation cluster rows. When a frame
 * sequence is provided (track results), the chip cycles through whichever
 * frames have loaded; unloaded slots are null and skipped.
 */
export default defineComponent({
  name: 'AdjudicationChip',
  props: {
    src: {
      type: String as PropType<string | null>,
      default: null,
    },
    /** Sampled track frames to cycle through (null slots still loading). */
    srcs: {
      type: Array as PropType<(string | null)[] | null>,
      default: null,
    },
    /** Whether to run the cycling animation (e.g. only while visible). */
    animate: {
      type: Boolean,
      default: false,
    },
    /** The snippet image could not be produced (vs still loading). */
    failed: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String,
      default: '',
    },
    subtitle: {
      type: String as PropType<string | null>,
      default: null,
    },
    /** Relevancy in [0, 1], or null to hide the score badge. */
    score: {
      type: Number as PropType<number | null>,
      default: null,
    },
    adjudication: {
      type: String as PropType<Adjudication | null>,
      default: null,
    },
    clickable: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const cycleIndex = ref(0);
    let cycleTimer: number | null = null;

    const hasSequence = computed(() => Boolean(props.srcs && props.srcs.length > 1));

    /** The frame currently shown: cycling slot if loaded, else primary. */
    const displaySrc = computed(() => {
      if (hasSequence.value && props.animate) {
        return props.srcs?.[cycleIndex.value] ?? props.src;
      }
      return props.src;
    });

    /** Step to the next loaded slot, skipping ones still null. */
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
      if (shouldRun && cycleTimer === null) {
        cycleTimer = window.setInterval(advance, CycleIntervalMs);
      } else if (!shouldRun && cycleTimer !== null) {
        window.clearInterval(cycleTimer);
        cycleTimer = null;
        cycleIndex.value = 0;
      }
    }
    watch([() => props.animate, () => props.srcs], syncTimer, { immediate: true });
    onBeforeUnmount(() => {
      if (cycleTimer !== null) window.clearInterval(cycleTimer);
    });

    return { displaySrc, hasSequence };
  },
});
</script>

<template>
  <v-card
    outlined
    class="adjudication-chip"
    :class="{
      'chip-clickable': clickable,
      'chip-positive': adjudication === 'positive',
      'chip-negative': adjudication === 'negative',
    }"
    @click="clickable && $emit('open')"
  >
    <div class="chip-image-wrap">
      <img
        v-if="displaySrc"
        :src="displaySrc"
        class="chip-image"
      >
      <div
        v-else-if="failed"
        class="chip-image chip-placeholder d-flex align-center justify-center"
      >
        <v-icon color="grey darken-1">
          mdi-image-off-outline
        </v-icon>
      </div>
      <div
        v-else
        class="chip-image chip-placeholder d-flex align-center justify-center"
      >
        <v-progress-circular
          indeterminate
          size="20"
          width="2"
          color="grey"
        />
      </div>
      <div
        v-if="score !== null"
        class="chip-score text-caption"
      >
        {{ (score * 100).toFixed(1) }}%
      </div>
      <v-icon
        v-if="hasSequence"
        small
        class="chip-sequence-badge"
        color="grey lighten-1"
      >
        mdi-filmstrip
      </v-icon>
      <div class="chip-actions">
        <v-btn
          icon
          small
          class="chip-action"
          :color="adjudication === 'positive' ? 'success' : 'grey lighten-1'"
          @click.stop="$emit('adjudicate', 'positive')"
        >
          <v-icon>
            {{ adjudication === 'positive' ? 'mdi-check-circle' : 'mdi-check-circle-outline' }}
          </v-icon>
        </v-btn>
        <v-btn
          icon
          small
          class="chip-action"
          :color="adjudication === 'negative' ? 'error' : 'grey lighten-1'"
          @click.stop="$emit('adjudicate', 'negative')"
        >
          <v-icon>
            {{ adjudication === 'negative' ? 'mdi-close-circle' : 'mdi-close-circle-outline' }}
          </v-icon>
        </v-btn>
      </div>
    </div>
    <div class="chip-caption px-2 py-1">
      <div class="text-caption chip-caption-line">
        {{ title }}
      </div>
      <div
        v-if="subtitle"
        class="text-caption grey--text chip-caption-line"
      >
        {{ subtitle }}
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.adjudication-chip {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Let a parent grid/flex track dictate the cell height. */
  min-height: 0;
}
.chip-clickable {
  cursor: pointer;
}
.chip-positive {
  border: 2px solid #4caf50;
}
.chip-negative {
  border: 2px solid #f44336;
}
.chip-image-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 48px;
  background: #181818;
}
.chip-image {
  /* Absolute so the image letterboxes into whatever space the cell has
     instead of its intrinsic size driving the cell height. */
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.chip-placeholder {
  background: #222;
}
.chip-score {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 0 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
}
.chip-sequence-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
}
.chip-actions {
  position: absolute;
  right: 2px;
  bottom: 2px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
}
.chip-caption {
  min-height: 24px;
}
.chip-caption-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}
</style>
