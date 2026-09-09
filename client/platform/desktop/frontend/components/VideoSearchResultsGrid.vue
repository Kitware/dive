<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, PropType, watch,
} from 'vue';
import { useHandler } from 'vue-media-annotator/provides';
import { useVideoSearch } from 'platform/desktop/frontend/useVideoSearch';
import type { SearchChips } from 'platform/desktop/frontend/useSearchChips';
import { usePersistentGridSettings } from 'dive-common/review/gridSettings';
import { useReviewGrid } from 'dive-common/review/useReviewGrid';
import type { ReviewItem } from 'dive-common/review/types';
import ReviewGrid from 'dive-common/components/Review/ReviewGrid.vue';
import ReviewGridControls from 'dive-common/components/Review/ReviewGridControls.vue';
import ReviewCell from 'dive-common/components/Review/ReviewCell.vue';

/** Footer height of a search cell (score line only), for the chip aspect ratio. */
const SearchCellFooterPx = 24;

/**
 * Full-window review grid of ranked search results across every indexed
 * video, for rapid adjudication: accept/reject each chip, then refine.
 * Shares session state (and adjudications) with the Video Search side
 * panel, and the grid shape, zoom, context and paging with the Review page.
 */
export default defineComponent({
  name: 'VideoSearchResultsGrid',
  components: { ReviewGrid, ReviewGridControls, ReviewCell },
  props: {
    value: {
      type: Boolean,
      default: false,
    },
    searchChips: {
      type: Object as PropType<SearchChips>,
      required: true,
    },
  },
  setup(props, { emit }) {
    const search = useVideoSearch();
    const handler = useHandler();
    const gridSettings = usePersistentGridSettings();
    const open = computed(() => props.value);
    const grid = useReviewGrid({
      items: props.searchChips.items,
      grid: gridSettings,
      chipStore: props.searchChips.store,
      active: open,
      footerPx: SearchCellFooterPx,
    });

    const state = computed(() => search?.state ?? null);
    const results = computed(() => state.value?.results ?? []);
    const resultsByRef = computed(() => new Map(results.value.map((r) => [r.ref, r])));

    const adjudicationCounts = computed(() => {
      const counts = { positive: 0, negative: 0 };
      Object.values(state.value?.adjudications ?? {}).forEach((adj) => {
        if (adj) counts[adj] += 1;
      });
      return counts;
    });

    const cells = computed(() => grid.pageItems.value.map((item) => {
      const result = resultsByRef.value.get(item.key);
      const datasetName = search && result ? search.resultDatasetName(result) : null;
      const local = Boolean(search && result && search.resultIsLocal(result));
      const bits = [`Frame ${item.primary.frame}`];
      if (datasetName) bits.push(datasetName);
      const adjudication: '' | 'positive' | 'negative' = (result && state.value?.adjudications[result.ref]) || '';
      return {
        item,
        local,
        adjudication,
        subtitle: bits.join(' · '),
        title: `${datasetName || 'This dataset'} · frame ${item.primary.frame}`,
      };
    }));

    const countLabel = computed(() => {
      const count = results.value.length;
      const base = `${count} result${count === 1 ? '' : 's'}`;
      return state.value?.iteration ? `${base} · iteration ${state.value.iteration}` : base;
    });

    function close() {
      emit('input', false);
    }

    function onKeydown(event: KeyboardEvent) {
      // Swallow paging keys before they bubble to document, where the
      // annotator's mousetrap left/right bindings would seek the (hidden)
      // playhead one frame per grid page turn.
      if (grid.handleKeydown(event)) {
        event.stopPropagation();
      }
    }
    watch(() => props.value, (isOpen) => {
      if (isOpen) {
        window.addEventListener('keydown', onKeydown, true);
      } else {
        window.removeEventListener('keydown', onKeydown, true);
      }
    });
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown, true);
      grid.dispose();
    });

    /** Jump the annotator to a result in the currently open dataset. */
    function openItem(item: ReviewItem) {
      const result = resultsByRef.value.get(item.key);
      if (!search || !result || !search.resultIsLocal(result)) return;
      handler.seekFrame(item.primary.frame);
      close();
    }

    function mark(item: ReviewItem, adjudication: 'positive' | 'negative') {
      search?.mark(item.key, adjudication);
    }

    return {
      search,
      state,
      results,
      gridSettings,
      grid,
      cells,
      countLabel,
      adjudicationCounts,
      close,
      openItem,
      mark,
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

      <ReviewGridControls
        :grid="gridSettings"
        :page="grid.page.value"
        :page-count="grid.pageCount.value"
        :count-label="countLabel"
        :can-zoom-in="grid.canZoomIn.value"
        :can-zoom-out="grid.canZoomOut.value"
        @update:page="grid.goToPage"
        @set-columns="grid.setColumns"
        @set-rows="grid.setRows"
        @set-padding="grid.setPadding"
        @zoom="grid.zoom"
      />

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
        class="results-grid-body flex-grow-1 pa-2"
      >
        <ReviewGrid
          :columns="gridSettings.columns"
          :rows="gridSettings.rows"
          @cell-size="grid.cellSize.value = $event"
        >
          <ReviewCell
            v-for="cell in cells"
            :key="cell.item.key"
            :src="searchChips.chips.value[cell.item.key] || null"
            :srcs="searchChips.store.sequences.value[cell.item.key] || null"
            :failure="searchChips.store.failures.value[cell.item.key] || null"
            :animate="value"
            :cycle-interval-ms="gridSettings.cycleIntervalMs"
            :confidence="cell.item.confidence"
            :frame-count="cell.item.keyframeCount"
            :title="cell.title"
            :highlight="cell.adjudication"
            :editable="false"
            @open="openItem(cell.item)"
          >
            <template #actions>
              <v-btn
                icon
                small
                class="chip-action"
                :color="cell.adjudication === 'positive' ? 'success' : 'grey lighten-1'"
                title="Mark as a correct match"
                @click.stop="mark(cell.item, 'positive')"
              >
                <v-icon>
                  {{ cell.adjudication === 'positive' ? 'mdi-check-circle' : 'mdi-check-circle-outline' }}
                </v-icon>
              </v-btn>
              <v-btn
                icon
                small
                class="chip-action"
                :color="cell.adjudication === 'negative' ? 'error' : 'grey lighten-1'"
                title="Mark as an incorrect match"
                @click.stop="mark(cell.item, 'negative')"
              >
                <v-icon>
                  {{ cell.adjudication === 'negative' ? 'mdi-close-circle' : 'mdi-close-circle-outline' }}
                </v-icon>
              </v-btn>
            </template>
            <template #footer>
              <div
                class="text-caption search-cell-caption"
                :class="{ 'grey--text': !cell.local }"
                :title="cell.local ? 'Click the image to open this frame' : 'Result from another dataset'"
              >
                {{ cell.subtitle }}
              </div>
            </template>
          </ReviewCell>
        </ReviewGrid>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.results-grid-page {
  height: 100vh;
}
.results-grid-body {
  min-height: 0;
  overflow: hidden;
}
.search-cell-caption {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}
</style>
