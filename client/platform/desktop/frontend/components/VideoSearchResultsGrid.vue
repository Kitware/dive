<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, PropType, ref, shallowRef, watch,
} from 'vue';
import { useHandler } from 'vue-media-annotator/provides';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useVideoSearch } from 'platform/desktop/frontend/useVideoSearch';
import type { SearchChips } from 'platform/desktop/frontend/useSearchChips';
import type { SearchReview } from 'platform/desktop/frontend/useSearchReview';
import type { ResultsGridMemory } from 'platform/desktop/frontend/querySession';
import { useReview } from 'dive-common/use/useReview';
import type { ReviewService } from 'dive-common/use/useReview';
import { usePersistentGridSettings } from 'dive-common/review/gridSettings';
import { useReviewGrid } from 'dive-common/review/useReviewGrid';
import type { ReviewItem } from 'dive-common/review/types';
import type { VideoSearchLayoutResponse, VideoSearchResult } from 'dive-common/apispec';
import type { SpacePoint } from 'platform/desktop/frontend/resultSpace';
import ReviewGrid from 'dive-common/components/Review/ReviewGrid.vue';
import ReviewGridControls from 'dive-common/components/Review/ReviewGridControls.vue';
import ReviewCell, { ReviewCellGeometryEdit } from 'dive-common/components/Review/ReviewCell.vue';
import VideoSearchResultsSpace, { SpaceCell } from './VideoSearchResultsSpace.vue';

/** Footer height of a search cell (type field and caption), for the chip aspect ratio. */
const SearchCellFooterPx = 48;
/** How many top results the 3D view may place. */
const SpaceCountChoices = [10, 25, 50, 100];
const DefaultSpaceCount = 25;

/**
 * Full-window review grid of ranked search results across every indexed
 * video, for rapid adjudication: accept/reject each chip, then refine.
 * Shares session state (and adjudications) with the Video Search side
 * panel, and the grid shape, zoom, context and paging with the Review page.
 * With a search review attached, cells are also editable annotations:
 * typing a type or adjusting a box adopts the result into its dataset.
 * An optional 3D view places the top results around the query in
 * descriptor space instead of the grid.
 */
export default defineComponent({
  name: 'VideoSearchResultsGrid',
  components: {
    ReviewGrid, ReviewGridControls, ReviewCell, VideoSearchResultsSpace,
  },
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
    /** Grid page and filter to start from, kept up to date so a later visit resumes them. */
    memory: {
      type: Object as PropType<ResultsGridMemory | null>,
      default: null,
    },
    /** Image of the query exemplar, shown at the center of the 3D view. */
    exemplarUrl: {
      type: String,
      default: '',
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

    const hideReviewed = ref(props.memory?.hideReviewed ?? false);
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

    // ---- 3D descriptor-space view ----------------------------------------
    const space = ref(props.memory?.space ?? false);
    const spaceCount = ref(props.memory?.spaceCount ?? DefaultSpaceCount);
    const spaceItems = computed(() => (space.value ? visibleItems.value.slice(0, spaceCount.value) : []));
    const spaceLayout = shallowRef<VideoSearchLayoutResponse | null>(null);
    const spaceLoading = ref(false);
    const spaceError = ref('');
    let spaceRequest = 0;
    // Refs are only comparable within a query generation; refinement
    // re-ranks, so the same refs in a new order still need a new layout.
    watch([
      () => state.value?.queryGeneration,
      () => state.value?.iteration,
      () => spaceItems.value.map((item) => item.key).join('\n'),
    ], async ([, , keys]) => {
      spaceRequest += 1;
      const request = spaceRequest;
      const refs = keys ? keys.split('\n') : [];
      if (!search || !refs.length) {
        spaceLayout.value = null;
        spaceLoading.value = false;
        return;
      }
      props.searchChips.store.ensurePrimary(spaceItems.value);
      spaceLoading.value = true;
      spaceError.value = '';
      try {
        const layout = await search.layoutResults(refs);
        if (request === spaceRequest) spaceLayout.value = layout;
      } catch (err) {
        if (request === spaceRequest) {
          spaceLayout.value = null;
          spaceError.value = err instanceof Error ? err.message : String(err);
        }
      } finally {
        if (request === spaceRequest) spaceLoading.value = false;
      }
    }, { immediate: true });

    const spacePoints = computed<SpacePoint[]>(() => (spaceLayout.value?.points ?? [])
      .map((point) => ({ key: point.ref, position: point.position })));
    const spaceCells = computed<SpaceCell[]>(() => {
      const distances = new Map((spaceLayout.value?.points ?? []).map((point) => [point.ref, point.distance]));
      return spaceItems.value.map((item, index): SpaceCell => {
        const result = resultsByRef.value.get(item.key);
        const datasetName = search && result ? search.resultDatasetName(result) : null;
        return {
          key: item.key,
          rank: index + 1,
          chip: props.searchChips.chips.value[item.key] || null,
          adjudication: (result && adjudications.value[result.ref]) || '',
          title: `${datasetName || 'This dataset'} · frame ${item.primary.frame}`,
          subtitle: [`Frame ${item.primary.frame}`, datasetName].filter(Boolean).join(' · '),
          score: result?.relevancy_score ?? 0,
          distance: distances.get(item.key) ?? 0,
        };
      });
    });
    const spaceMissingCount = computed(() => spaceLayout.value?.missing?.length ?? 0);

    if (props.memory) {
      grid.goToPage(props.memory.page);
      watch([grid.page, hideReviewed, space, spaceCount], ([page, hide, inSpace, count]) => {
        Object.assign(props.memory as ResultsGridMemory, {
          page, hideReviewed: hide, space: inSpace, spaceCount: count,
        });
      });
    }

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
      if (!space.value && grid.handleKeydown(event)) {
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

    function openSpaceItem(key: string) {
      const item = props.searchChips.itemsByRef.value.get(key);
      if (item) openItem(item);
    }

    function markSpaceItem(key: string, adjudication: 'positive' | 'negative') {
      search?.mark(key, adjudication);
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
      if (!props.searchReview || !props.searchReview.hasChanges.value) return;
      const count = props.searchReview.changeCount.value;
      const ok = await prompt({
        title: 'Discard changes',
        text: `Throw away ${count} unsaved annotation change${count === 1 ? '' : 's'} from the results?`,
        confirm: true,
      });
      if (ok) await props.searchReview.discardAll();
    }

    function save() {
      props.searchReview?.save();
    }

    // Own computeds so the toolbar tracks nested refs on the plain searchReview
    // object (Vue 2 does not deeply proxy prop contents).
    const annotationHasChanges = computed(() => props.searchReview?.hasChanges.value ?? false);
    const annotationChangeCount = computed(() => props.searchReview?.changeCount.value ?? 0);

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
      annotationHasChanges,
      annotationChangeCount,
      space,
      spaceCount,
      spaceCountChoices: SpaceCountChoices,
      spacePoints,
      spaceCells,
      spaceLoading,
      spaceError,
      spaceMissingCount,
      openSpaceItem,
      markSpaceItem,
      close,
      openItem,
      mark,
      assign,
      editGeometry,
      remove,
      discard,
      save,
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
        <v-btn-toggle
          :value="space ? 'space' : 'grid'"
          mandatory
          dense
          class="ml-4"
          @change="space = $event === 'space'"
        >
          <v-btn
            small
            value="grid"
            title="Ranked chip grid"
          >
            <v-icon small>
              mdi-view-grid-outline
            </v-icon>
          </v-btn>
          <v-btn
            small
            value="space"
            title="Top results around the query in 3D descriptor space"
          >
            <v-icon small>
              mdi-cube-outline
            </v-icon>
          </v-btn>
        </v-btn-toggle>
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
        <template v-if="review && searchReview">
          <v-btn
            small
            outlined
            class="ml-2"
            :disabled="!annotationHasChanges || review.saving.value"
            title="Throw away the unsaved annotation changes"
            @click="discard"
          >
            Discard
          </v-btn>
          <v-btn
            small
            outlined
            class="ml-2"
            :disabled="!state.modelAvailable || !!state.busy"
            title="Keep the refined classifier as a trained pipeline"
            @click="$emit('save-model')"
          >
            <v-icon
              small
              left
            >
              mdi-content-save-outline
            </v-icon>
            Save model
          </v-btn>
          <v-btn
            small
            color="primary"
            class="ml-2"
            :disabled="!annotationHasChanges"
            :loading="review.saving.value"
            title="Save accepted and typed results as annotations of their datasets"
            @click="save"
          >
            <v-icon
              small
              left
            >
              mdi-content-save
            </v-icon>
            Save Annotations<span
              v-if="annotationChangeCount"
              class="ml-1"
            >({{ annotationChangeCount }})</span>
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

      <div
        v-if="space"
        class="d-flex align-center px-2 py-1 flex-grow-0"
      >
        <span class="text-caption mr-3">{{ countLabel }}</span>
        <v-select
          :value="spaceCount"
          :items="spaceCountChoices"
          label="Results shown"
          dense
          outlined
          hide-details
          class="space-count"
          @change="spaceCount = $event"
        />
        <v-btn
          small
          :text="!hideReviewed"
          :outlined="hideReviewed"
          :color="hideReviewed ? 'primary' : undefined"
          class="ml-2"
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
        <v-spacer />
        <span class="text-caption grey--text">Drag to orbit · wheel to zoom · double click to open</span>
      </div>
      <ReviewGridControls
        v-else
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
        v-if="space"
        class="results-grid-body flex-grow-1"
      >
        <VideoSearchResultsSpace
          :points="spacePoints"
          :cells="spaceCells"
          :exemplar-url="exemplarUrl"
          :loading="spaceLoading"
          :error="spaceError"
          :missing-count="spaceMissingCount"
          @open="openSpaceItem"
          @mark="markSpaceItem"
        />
      </div>
      <div
        v-else-if="!cells.length"
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
                color="success"
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
                color="error"
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
.space-count {
  max-width: 160px;
}
</style>
