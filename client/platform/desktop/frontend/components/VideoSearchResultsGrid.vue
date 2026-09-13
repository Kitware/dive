<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, PropType, ref, watch,
} from 'vue';
import { useHandler } from 'vue-media-annotator/provides';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useVideoSearch } from 'platform/desktop/frontend/useVideoSearch';
import type { SearchChips } from 'platform/desktop/frontend/useSearchChips';
import type { SearchReview } from 'platform/desktop/frontend/useSearchReview';
import { useReview } from 'dive-common/use/useReview';
import type { ReviewService } from 'dive-common/use/useReview';
import { usePersistentGridSettings } from 'dive-common/review/gridSettings';
import { useReviewGrid } from 'dive-common/review/useReviewGrid';
import type { ReviewItem } from 'dive-common/review/types';
import type { VideoSearchResult } from 'dive-common/apispec';
import ReviewGrid from 'dive-common/components/Review/ReviewGrid.vue';
import ReviewGridControls from 'dive-common/components/Review/ReviewGridControls.vue';
import ReviewCell, { ReviewCellGeometryEdit } from 'dive-common/components/Review/ReviewCell.vue';

/** Footer height of a search cell (type field and caption), for the chip aspect ratio. */
const SearchCellFooterPx = 48;

/**
 * Full-window review grid of ranked search results across every indexed
 * video, for rapid adjudication: accept/reject each chip, then refine.
 * Shares session state (and adjudications) with the Video Search side
 * panel, and the grid shape, zoom, context and paging with the Review page.
 * With a search review attached, cells are also editable annotations:
 * typing a type or adjusting a box adopts the result into its dataset.
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
    /**
     * Render in place instead of as a full-window dialog (the Query page).
     * Opening a result then emits `open-result` rather than seeking.
     */
    inline: {
      type: Boolean,
      default: false,
    },
    /** Lets results be typed, edited and deleted as annotations (needs a provided review service). */
    searchReview: {
      type: Object as PropType<SearchReview | null>,
      default: null,
    },
  },
  setup(props, { emit }) {
    const search = useVideoSearch();
    // The annotator handler only exists inside the viewer.
    const handler = props.inline ? null : useHandler();
    const review: ReviewService | null = props.searchReview ? useReview() : null;
    const { prompt } = usePrompt();
    const gridSettings = usePersistentGridSettings();
    const open = computed(() => props.inline || props.value);

    const state = computed(() => search?.state ?? null);
    const results = computed(() => state.value?.results ?? []);
    const resultsByRef = computed(() => new Map(results.value.map((r) => [r.ref, r])));
    const adjudications = computed(() => state.value?.adjudications ?? {});

    const hideReviewed = ref(false);
    const reviewedCount = computed(() => props.searchChips.items.value
      .filter((item) => adjudications.value[item.key]).length);
    const visibleItems = computed(() => (hideReviewed.value
      ? props.searchChips.items.value.filter((item) => !adjudications.value[item.key])
      : props.searchChips.items.value));

    const grid = useReviewGrid({
      items: visibleItems,
      grid: gridSettings,
      chipStore: props.searchChips.store,
      active: open,
      footerPx: SearchCellFooterPx,
      // The box is drawn over the chip so it follows edits.
      outline: '',
      retainPage: true,
    });
    watch(() => state.value?.queryGeneration, () => grid.goToPage(0));

    const adjudicationCounts = computed(() => {
      const counts = { positive: 0, negative: 0 };
      Object.values(adjudications.value).forEach((adj) => {
        if (adj) counts[adj] += 1;
      });
      return counts;
    });

    const cells = computed(() => {
      // Carries dataRevision so type and box edits re-render.
      const revision = review?.dataRevision.value ?? 0;
      return grid.pageItems.value.map((item) => {
        const result = resultsByRef.value.get(item.key);
        const adopted = result && props.searchReview ? props.searchReview.itemOf(result) : undefined;
        const current = adopted && review ? review.currentType(adopted) : null;
        const datasetName = search && result ? search.resultDatasetName(result) : null;
        const local = Boolean(search && result && search.resultIsLocal(result));
        const bits = [`Frame ${item.primary.frame}`];
        if (datasetName) bits.push(datasetName);
        if (adopted) bits.push(`#${adopted.trackId}`);
        const adjudication: '' | 'positive' | 'negative' = (result && adjudications.value[result.ref]) || '';
        const type = current?.type ?? '';
        return {
          item,
          result,
          revision,
          local,
          adjudication,
          adopted: adopted !== undefined,
          type,
          pending: adopted && review ? review.isPending(adopted) : false,
          color: review ? review.colorFor(type) : '#00e5ff',
          subtitle: bits.join(' · '),
          title: `${datasetName || 'This dataset'} · frame ${item.primary.frame}`,
        };
      });
    });

    const countLabel = computed(() => {
      const count = visibleItems.value.length;
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
    watch(open, (isOpen) => {
      if (isOpen) {
        window.addEventListener('keydown', onKeydown, true);
      } else {
        window.removeEventListener('keydown', onKeydown, true);
      }
    }, { immediate: true });
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown, true);
      grid.dispose();
    });

    /** Jump the annotator to a result in the currently open dataset, or hand it up inline. */
    function openItem(item: ReviewItem, frame?: number) {
      const result = resultsByRef.value.get(item.key);
      if (!search || !result) return;
      const shown = frame ?? item.primary.frame;
      if (props.inline) {
        const datasetId = search.resultDatasetId(result);
        const adopted = props.searchReview?.itemOf(result);
        if (datasetId) emit('open-result', datasetId, shown, adopted?.trackId);
        return;
      }
      if (!handler || !search.resultIsLocal(result)) return;
      handler.seekFrame(shown);
      close();
    }

    function mark(item: ReviewItem, adjudication: 'positive' | 'negative') {
      search?.mark(item.key, adjudication);
    }

    function assign(result: VideoSearchResult | undefined, type: string) {
      if (result && props.searchReview) props.searchReview.assignType(result, type);
    }

    function editGeometry(result: VideoSearchResult | undefined, edit: ReviewCellGeometryEdit) {
      if (result && props.searchReview) props.searchReview.editGeometry(result, edit);
    }

    function remove(result: VideoSearchResult | undefined) {
      if (result && props.searchReview) props.searchReview.remove(result);
    }

    async function discard() {
      if (!review || review.pendingCount.value === 0) return;
      const count = review.pendingCount.value;
      const ok = await prompt({
        title: 'Discard changes',
        text: `Throw away ${count} unsaved annotation change${count === 1 ? '' : 's'}?`,
        confirm: true,
      });
      if (ok) await review.discardChanges();
    }

    return {
      search,
      state,
      results,
      review,
      open,
      gridSettings,
      grid,
      cells,
      countLabel,
      adjudicationCounts,
      hideReviewed,
      reviewedCount,
      close,
      openItem,
      mark,
      assign,
      editGeometry,
      remove,
      discard,
    };
  },
});
</script>

<template>
  <component
    :is="inline ? 'div' : 'v-dialog'"
    v-bind="inline ? {} : {
      value, fullscreen: true, hideOverlay: true, transition: 'dialog-bottom-transition',
    }"
    :class="{ 'results-grid-inline': inline }"
    @input="inline ? undefined : $emit('input', $event)"
  >
    <v-card
      v-if="search && state"
      class="results-grid-page d-flex flex-column"
      :class="{ 'results-grid-page-inline': inline }"
      :flat="inline"
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
        <template v-if="review">
          <v-btn
            small
            outlined
            class="ml-2"
            :disabled="review.pendingCount.value === 0 || review.saving.value"
            title="Throw away the unsaved annotation changes"
            @click="discard"
          >
            Discard
          </v-btn>
          <v-btn
            small
            color="primary"
            class="ml-2"
            :disabled="review.pendingCount.value === 0"
            :loading="review.saving.value"
            title="Save the changed annotations to their datasets"
            @click="review.save()"
          >
            <v-icon
              small
              left
            >
              mdi-content-save
            </v-icon>
            Save<span
              v-if="review.pendingCount.value"
              class="ml-1"
            >({{ review.pendingCount.value }})</span>
          </v-btn>
        </template>
        <v-btn
          v-if="!inline"
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
      >
        <v-btn
          small
          :text="!hideReviewed"
          :outlined="hideReviewed"
          :color="hideReviewed ? 'primary' : undefined"
          class="mr-2"
          title="Hide the results already marked correct or incorrect"
          @click="hideReviewed = !hideReviewed"
        >
          <v-icon
            small
            left
          >
            {{ hideReviewed ? 'mdi-eye-off' : 'mdi-eye-off-outline' }}
          </v-icon>
          Hide reviewed
          <span
            v-if="reviewedCount"
            class="ml-1 grey--text"
          >({{ reviewedCount }})</span>
        </v-btn>
      </ReviewGridControls>

      <v-progress-linear
        v-if="state.busy || (review && review.saving.value)"
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
      <v-alert
        v-if="searchReview && searchReview.error.value"
        type="error"
        dense
        text
        dismissible
        class="ma-2 flex-grow-0"
        @input="searchReview.clearError()"
      >
        {{ searchReview.error.value }}
      </v-alert>
      <v-alert
        v-if="review && review.error.value"
        type="error"
        dense
        text
        dismissible
        class="ma-2 flex-grow-0"
        @input="review.clearError()"
      >
        {{ review.error.value }}
      </v-alert>

      <div
        v-if="!cells.length"
        class="d-flex align-center justify-center flex-grow-1 grey--text"
      >
        {{ results.length && hideReviewed ? 'Every result has been reviewed.' : 'No search results to review.' }}
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
            :transform="searchChips.store.transforms.value[cell.item.key] || null"
            :transforms="searchChips.store.sequenceTransforms.value[cell.item.key] || null"
            :frames="cell.item.frames"
            :failure="searchChips.store.failures.value[cell.item.key] || null"
            :animate="open"
            :cycle-interval-ms="gridSettings.cycleIntervalMs"
            :confidence="cell.item.confidence"
            :frame-count="cell.item.keyframeCount"
            :type="cell.type"
            :type-options="review ? review.knownTypes.value : []"
            :color="cell.color"
            :pending="cell.pending"
            :editable="!!searchReview"
            :deletable="false"
            :title="cell.title"
            :subtitle="cell.subtitle"
            :highlight="cell.adjudication"
            @assign="assign(cell.result, $event)"
            @open="openItem(cell.item, $event)"
            @edit-geometry="editGeometry(cell.result, $event)"
          >
            <template #actions="{ beginEdit, frame }">
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
              <v-btn
                v-if="searchReview"
                icon
                small
                class="chip-action"
                title="Edit this frame's box as an annotation (or right click)"
                @click.stop="beginEdit($event)"
              >
                <v-icon color="grey lighten-1">
                  mdi-vector-square-edit
                </v-icon>
              </v-btn>
              <v-btn
                v-if="cell.adopted"
                icon
                small
                class="chip-action"
                title="Delete this annotation"
                @click.stop="remove(cell.result)"
              >
                <v-icon color="red lighten-1">
                  mdi-delete-outline
                </v-icon>
              </v-btn>
              <v-btn
                icon
                small
                class="chip-action"
                title="Open in the annotation viewer at this frame (or double click)"
                @click.stop="openItem(cell.item, frame)"
              >
                <v-icon color="grey lighten-1">
                  mdi-open-in-new
                </v-icon>
              </v-btn>
            </template>
          </ReviewCell>
        </ReviewGrid>
      </div>
    </v-card>
  </component>
</template>

<style scoped>
.results-grid-page {
  height: 100vh;
}
.results-grid-inline,
.results-grid-page-inline {
  height: 100%;
  min-height: 0;
}
.results-grid-body {
  min-height: 0;
  overflow: hidden;
}
</style>
