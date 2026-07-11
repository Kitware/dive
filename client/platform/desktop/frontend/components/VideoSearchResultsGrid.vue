<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, PropType, ref, watch,
} from 'vue';
import { useHandler } from 'vue-media-annotator/provides';
import type { VideoSearchResult } from 'dive-common/apispec';
import { useVideoSearch } from 'platform/desktop/frontend/useVideoSearch';
import { resultFrame, ResultChipStore } from 'platform/desktop/frontend/useResultChips';
import AdjudicationChip from 'platform/desktop/frontend/components/AdjudicationChip.vue';

const PageSize = 20; // 5 columns x 4 rows

/**
 * Full-window grid of ranked search results across every indexed video,
 * for rapid adjudication: accept/reject each chip, then refine. Shares
 * session state (and adjudications) with the Video Search side panel.
 */
export default defineComponent({
  name: 'VideoSearchResultsGrid',
  components: { AdjudicationChip },
  props: {
    value: {
      type: Boolean,
      default: false,
    },
    chipStore: {
      type: Object as PropType<ResultChipStore>,
      required: true,
    },
  },
  setup(props, { emit }) {
    const search = useVideoSearch();
    const handler = useHandler();
    const page = ref(0);

    const state = computed(() => search?.state ?? null);
    const results = computed(() => state.value?.results ?? []);
    const pageCount = computed(() => Math.max(1, Math.ceil(results.value.length / PageSize)));
    const pageResults = computed(
      () => results.value.slice(page.value * PageSize, (page.value + 1) * PageSize),
    );
    const chips = computed(() => props.chipStore.chips.value);

    const adjudicationCounts = computed(() => {
      const counts = { positive: 0, negative: 0 };
      Object.values(state.value?.adjudications ?? {}).forEach((adj) => {
        if (adj) counts[adj] += 1;
      });
      return counts;
    });

    function close() {
      emit('input', false);
    }

    function prevPage() {
      page.value = Math.max(0, page.value - 1);
    }

    function nextPage() {
      page.value = Math.min(pageCount.value - 1, page.value + 1);
    }

    /**
     * Load chips for the visible page and prefetch the next one, plus
     * cycling track sequences for just the visible page (each sequence
     * frame can cost a backend ffmpeg extraction).
     */
    function ensureVisibleChips() {
      if (!props.value) return;
      props.chipStore.ensure(
        results.value.slice(page.value * PageSize, (page.value + 2) * PageSize),
      );
      props.chipStore.ensureSequences(
        results.value.slice(page.value * PageSize, (page.value + 1) * PageSize),
      );
    }
    watch([() => props.value, page], ensureVisibleChips);
    // Refinement re-ranks everything, so restart from the top page.
    watch(results, () => {
      page.value = 0;
      ensureVisibleChips();
    });

    function onKeydown(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      // Swallow the event before it bubbles to document, where the
      // annotator's mousetrap left/right bindings would seek the (hidden)
      // playhead one frame per grid page turn.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'ArrowLeft') {
        prevPage();
      } else {
        nextPage();
      }
    }
    watch(() => props.value, (open) => {
      if (open) {
        window.addEventListener('keydown', onKeydown, true);
      } else {
        window.removeEventListener('keydown', onKeydown, true);
      }
    });
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown, true);
    });

    function isLocalResult(result: VideoSearchResult): boolean {
      return search !== null && search.resultIsLocal(result);
    }

    function chipTitle(result: VideoSearchResult): string {
      const frameNum = resultFrame(result);
      return frameNum !== null ? `Frame ${frameNum}` : '';
    }

    /** Jump the annotator to a result in the currently open dataset. */
    function openResult(result: VideoSearchResult) {
      if (!isLocalResult(result)) return;
      const target = resultFrame(result);
      if (target !== null) {
        handler.seekFrame(target);
        close();
      }
    }

    return {
      search,
      state,
      results,
      page,
      pageCount,
      pageResults,
      chips,
      adjudicationCounts,
      close,
      prevPage,
      nextPage,
      isLocalResult,
      chipTitle,
      openResult,
    };
  },
});
</script>

<template>
  <v-dialog
    :value="value"
    fullscreen
    hide-overlay
    transition="dialog-bottom-transition"
    @input="$emit('input', $event)"
  >
    <v-card
      v-if="search && state"
      class="results-grid-page d-flex flex-column"
    >
      <v-toolbar
        dense
        flat
        color="grey darken-4"
        class="flex-grow-0"
      >
        <v-toolbar-title class="text-subtitle-1">
          Search Results
          <span class="text-caption grey--text ml-2">
            {{ results.length }} results
            <template v-if="state.iteration">
              — iteration {{ state.iteration }}
            </template>
          </span>
        </v-toolbar-title>
        <v-spacer />
        <span class="text-caption mr-3">
          <v-icon
            small
            color="success"
          >
            mdi-check-circle
          </v-icon>
          {{ adjudicationCounts.positive }}
          <v-icon
            small
            color="error"
            class="ml-2"
          >
            mdi-close-circle
          </v-icon>
          {{ adjudicationCounts.negative }}
        </span>
        <v-btn
          small
          color="primary"
          :disabled="!!state.busy || (!adjudicationCounts.positive && !adjudicationCounts.negative)"
          @click="search.refine()"
        >
          Refine
        </v-btn>
        <v-btn
          icon
          class="ml-2"
          @click="close"
        >
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>

      <v-progress-linear
        v-if="state.busy"
        indeterminate
        class="flex-grow-0"
      />
      <v-alert
        v-if="state.error"
        type="error"
        dense
        text
        class="ma-2 flex-grow-0"
      >
        {{ state.error }}
      </v-alert>

      <div
        v-if="!results.length"
        class="d-flex align-center justify-center flex-grow-1 grey--text"
      >
        No search results to review.
      </div>
      <div
        v-else
        class="results-grid flex-grow-1 pa-2"
      >
        <adjudication-chip
          v-for="result in pageResults"
          :key="result.ref"
          :src="chips[result.ref] || null"
          :srcs="chipStore.sequences.value[result.ref] || null"
          :animate="value"
          :failed="Boolean(chipStore.failures.value[result.ref])"
          :title="chipTitle(result)"
          :subtitle="search.resultDatasetName(result)"
          :score="result.relevancy_score"
          :adjudication="state.adjudications[result.ref] || null"
          :clickable="isLocalResult(result)"
          @adjudicate="search.mark(result.ref, $event)"
          @open="openResult(result)"
        />
      </div>

      <div class="d-flex align-center justify-center py-1 flex-grow-0">
        <v-btn
          icon
          :disabled="page === 0"
          @click="prevPage"
        >
          <v-icon>mdi-chevron-left</v-icon>
        </v-btn>
        <span class="text-caption mx-3">
          Page {{ page + 1 }} of {{ pageCount }}
        </span>
        <v-btn
          icon
          :disabled="page >= pageCount - 1"
          @click="nextPage"
        >
          <v-icon>mdi-chevron-right</v-icon>
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.results-grid-page {
  height: 100vh;
}
.results-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: repeat(4, 1fr);
  gap: 8px;
  min-height: 0;
  overflow: hidden;
}
</style>
