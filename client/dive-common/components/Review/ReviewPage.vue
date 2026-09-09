<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, PropType, ref, watch,
} from 'vue';
import { onBeforeRouteLeave } from 'vue-router/composables';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { createReviewService, provideReview } from 'dive-common/use/useReview';
import { useReviewGrid } from 'dive-common/review/useReviewGrid';
import { cellScaleFor } from 'dive-common/review/gridSettings';
import { ReviewItem, ReviewSortOrder } from 'dive-common/review/types';
import type { ViewerFocus } from 'dive-common/review/viewerNavigation';
import ReviewDatasetsPanel from './ReviewDatasetsPanel.vue';
import ReviewGrid from './ReviewGrid.vue';
import ReviewGridControls from './ReviewGridControls.vue';
import ReviewCell, { ReviewCellGeometryEdit } from './ReviewCell.vue';

const TYPE_LIST_ID = 'reviewTypeOptions';

/** Base footer height of a cell at scale 1 (type field plus caption). */
const CELL_FOOTER_BASE_PX = 52;

type ReviewView = 'results' | 'datasets';

const SORT_OPTIONS: { value: ReviewSortOrder; text: string }[] = [
  { value: 'dataset', text: 'Dataset, track id' },
  { value: 'confidence-asc', text: 'Confidence, low first' },
  { value: 'confidence-desc', text: 'Confidence, high first' },
  { value: 'frame', text: 'Frame' },
];

const SCOPE_OPTIONS = [
  { value: 'any', text: 'Track or detection' },
  { value: 'track', text: 'Track attributes' },
  { value: 'detection', text: 'Detection attributes' },
];

/**
 * The review page: pick datasets, then page through every annotation of a
 * type (above a confidence) or carrying an attribute as a grid of cropped
 * chips, correcting types in place. Platform shells own routing; this emits
 * `open-viewer` with a dataset id and a {@link ViewerFocus}.
 */
export default defineComponent({
  name: 'ReviewPage',
  components: {
    ReviewDatasetsPanel, ReviewGrid, ReviewGridControls, ReviewCell,
  },
  props: {
    initialDatasetIds: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },
  setup(props, { emit }) {
    const api = useApi();
    const review = createReviewService({ api });
    provideReview(review);
    const { prompt } = usePrompt();

    const view = ref<ReviewView>('results');
    const pageTypeInput = ref('');
    const gridActive = computed(() => view.value === 'results');
    const cellScale = computed(() => cellScaleFor(review.grid.columns, review.grid.rows));
    const footerPx = computed(() => Math.round(CELL_FOOTER_BASE_PX * cellScale.value));
    const grid = useReviewGrid({
      items: review.items,
      grid: review.grid,
      chipStore: review.chipStore,
      active: gridActive,
      footerPx,
    });

    const showDatasetNames = computed(() => review.datasets.value.length > 1);
    const readyDatasets = computed(() => review.datasets.value.filter((d) => d.status === 'ready').length);

    /** Per-cell display data; carries dataRevision so edits re-render. */
    const cells = computed(() => {
      const revision = review.dataRevision.value;
      return grid.pageItems.value.map((item) => {
        const current = review.currentType(item);
        const attribute = item.matchedAttribute;
        const attributeText = attribute
          ? `${attribute.key}${attribute.value === true ? '' : ` = ${String(attribute.value)}`}`
          : '';
        const subtitleBits = [];
        if (showDatasetNames.value) subtitleBits.push(review.datasetName(item.datasetId));
        subtitleBits.push(`#${item.trackId}`);
        subtitleBits.push(item.frames.length > 1 ? `${item.keyframeCount} frames` : `frame ${item.primary.frame}`);
        return {
          item,
          revision,
          type: current.type,
          confidence: current.confidence,
          pending: review.isPending(item),
          title: `${review.datasetName(item.datasetId)} · track ${item.trackId} · frame ${item.primary.frame}`,
          subtitle: subtitleBits.join(' · '),
          attributeText,
          frames: item.frames,
        };
      });
    });

    const typeItems = computed(() => [
      { value: '', text: 'Any type' },
      ...review.types.value.map((t) => ({ value: t, text: t })),
    ]);

    const countLabel = computed(() => {
      const count = review.items.value.length;
      const base = `${count} entr${count === 1 ? 'y' : 'ies'}`;
      return review.stale.value ? `${base} · query changed, press Show` : base;
    });

    function show() {
      review.runQuery();
      view.value = 'results';
    }

    function setView(next: ReviewView) {
      if (next === 'results' && review.stale.value) {
        review.runQuery();
      }
      view.value = next;
    }

    /** Open the viewer on the frame the cell is showing (its first frame otherwise). */
    function openItem(item: ReviewItem, frame?: number) {
      const focus: ViewerFocus = { frame: frame ?? item.primary.frame, trackId: item.trackId };
      emit('open-viewer', item.datasetId, focus);
    }

    function applyGeometry(item: ReviewItem, edit: ReviewCellGeometryEdit) {
      review.updateGeometry(item, edit.frame, {
        bounds: edit.bounds ?? undefined,
        polygons: edit.polygons,
        head: edit.head,
        tail: edit.tail,
      });
      grid.ensureVisible();
    }

    function openDataset(datasetId: string) {
      emit('open-viewer', datasetId, {});
    }

    function applyTypeToPage() {
      const type = pageTypeInput.value.trim();
      if (!type) return;
      grid.pageItems.value.forEach((item) => review.assignType(item, type));
    }

    function acceptPage() {
      grid.pageItems.value.forEach((item) => review.acceptType(item));
    }

    async function discard() {
      if (review.pendingCount.value === 0) return;
      const ok = await prompt({
        title: 'Discard changes',
        text: `Throw away ${review.pendingCount.value} unsaved type change${review.pendingCount.value === 1 ? '' : 's'}?`,
        confirm: true,
      });
      if (ok) await review.discardChanges();
    }

    function onKeydown(event: KeyboardEvent) {
      grid.handleKeydown(event);
    }

    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (review.pendingCount.value > 0) {
        event.preventDefault();
        // eslint-disable-next-line no-param-reassign
        event.returnValue = '';
      }
    }

    onBeforeRouteLeave(async (_to, _from, next) => {
      if (review.pendingCount.value === 0) {
        next();
        return;
      }
      const leave = await prompt({
        title: 'Unsaved changes',
        text: [
          `${review.pendingCount.value} type change${review.pendingCount.value === 1 ? '' : 's'} have not been saved.`,
          'Leave anyway and lose them?',
        ],
        confirm: true,
        positiveButton: 'Leave',
        negativeButton: 'Stay',
      });
      if (leave) {
        next();
      } else {
        next(false);
      }
    });

    async function applyInitial(ids: string[]) {
      if (ids.length === 0) return;
      await review.addDatasets(ids);
      if (review.datasets.value.some((d) => d.status === 'ready')) {
        show();
      }
    }

    onMounted(async () => {
      window.addEventListener('keydown', onKeydown);
      window.addEventListener('beforeunload', onBeforeUnload);
      await review.refreshAvailable();
      await applyInitial(props.initialDatasetIds);
    });
    watch(() => props.initialDatasetIds, (ids) => { applyInitial(ids); });
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('beforeunload', onBeforeUnload);
      grid.dispose();
      review.dispose();
    });

    return {
      review,
      view,
      grid,
      cells,
      cellScale,
      typeItems,
      typeListId: TYPE_LIST_ID,
      sortOptions: SORT_OPTIONS,
      scopeOptions: SCOPE_OPTIONS,
      readyDatasets,
      countLabel,
      pageTypeInput,
      show,
      setView,
      openItem,
      openDataset,
      applyGeometry,
      applyTypeToPage,
      acceptPage,
      discard,
    };
  },
});
</script>

<template>
  <div class="review-page">
    <div class="review-toolbar d-flex align-center flex-wrap px-2 pt-2">
      <v-btn-toggle
        :value="view"
        mandatory
        dense
        class="mr-3"
        @change="setView"
      >
        <v-btn
          small
          value="results"
        >
          <v-icon
            small
            left
          >
            mdi-view-grid
          </v-icon>
          Results
        </v-btn>
        <v-btn
          small
          value="datasets"
        >
          <v-icon
            small
            left
          >
            mdi-database
          </v-icon>
          Datasets
          <span class="ml-1 grey--text">({{ review.datasets.value.length }})</span>
        </v-btn>
      </v-btn-toggle>

      <template v-if="view === 'results' && readyDatasets > 0">
        <v-btn-toggle
          :value="review.query.mode"
          mandatory
          dense
          class="mr-2"
          @change="review.query.mode = $event"
        >
          <v-btn
            small
            value="type"
          >
            Type
          </v-btn>
          <v-btn
            small
            value="attribute"
          >
            Attribute
          </v-btn>
        </v-btn-toggle>

        <template v-if="review.query.mode === 'type'">
          <v-autocomplete
            :value="review.query.type"
            :items="typeItems"
            dense
            outlined
            hide-details
            class="query-field type-field mr-2"
            @change="review.query.type = $event || ''"
          />
          <div class="d-flex align-center threshold-field mr-2">
            <span class="text-caption grey--text mr-2 text-no-wrap">Min confidence</span>
            <v-slider
              :value="review.query.threshold"
              min="0"
              max="1"
              step="0.01"
              hide-details
              class="threshold-slider"
              @input="review.query.threshold = Number($event)"
            />
            <v-text-field
              :value="review.query.threshold"
              type="number"
              min="0"
              max="1"
              step="0.05"
              dense
              outlined
              hide-details
              class="threshold-number ml-2"
              @change="review.query.threshold = Math.min(1, Math.max(0, Number($event) || 0))"
            />
          </div>
        </template>
        <template v-else>
          <v-combobox
            :value="review.query.attributeKey"
            :items="review.attributeKeys.value"
            label="Attribute"
            dense
            outlined
            hide-details
            class="query-field mr-2"
            @input="review.query.attributeKey = $event || ''"
          />
          <v-text-field
            :value="review.query.attributeValue"
            label="Value (any when empty)"
            dense
            outlined
            hide-details
            clearable
            class="query-field mr-2"
            @input="review.query.attributeValue = $event || ''"
          />
          <v-select
            :value="review.query.attributeScope"
            :items="scopeOptions"
            dense
            outlined
            hide-details
            class="query-field scope-field mr-2"
            @change="review.query.attributeScope = $event"
          />
        </template>
        <v-btn
          small
          :color="review.stale.value ? 'primary' : undefined"
          :outlined="!review.stale.value"
          depressed
          class="mr-2"
          @click="show"
        >
          <v-icon
            small
            left
          >
            mdi-magnify
          </v-icon>
          Show
        </v-btn>
      </template>

      <v-spacer />

      <span
        v-if="review.pendingCount.value > 0"
        class="text-caption amber--text mr-2"
      >
        {{ review.pendingCount.value }} unsaved
      </span>
      <v-btn
        small
        text
        :disabled="review.pendingCount.value === 0 || review.saving.value"
        class="mr-1"
        @click="discard"
      >
        Discard
      </v-btn>
      <v-btn
        small
        depressed
        color="primary"
        :disabled="review.pendingCount.value === 0"
        :loading="review.saving.value"
        @click="review.save()"
      >
        <v-icon
          small
          left
        >
          mdi-content-save
        </v-icon>
        Save
      </v-btn>
    </div>

    <ReviewGridControls
      v-if="view === 'results' && readyDatasets > 0"
      :grid="review.grid"
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
      <template #before>
        <v-select
          :value="review.sort.value"
          :items="sortOptions"
          dense
          outlined
          hide-details
          class="sort-field mr-3"
          prepend-inner-icon="mdi-sort"
          @change="review.sort.value = $event"
        />
      </template>
      <v-menu
        offset-y
        :close-on-content-click="false"
      >
        <template #activator="{ on }">
          <v-btn
            small
            text
            :disabled="grid.pageItems.value.length === 0"
            v-on="on"
          >
            <v-icon
              small
              left
            >
              mdi-select-all
            </v-icon>
            Page actions
          </v-btn>
        </template>
        <v-card class="pa-3 page-actions">
          <div class="text-caption grey--text mb-2">
            Applies to the {{ grid.pageItems.value.length }} entries on this page.
          </div>
          <div class="d-flex align-center mb-2">
            <input
              v-model="pageTypeInput"
              type="text"
              class="page-type-input mr-2"
              placeholder="Type"
              :list="typeListId"
              @keydown.enter="applyTypeToPage"
            >
            <v-btn
              small
              depressed
              :disabled="!pageTypeInput.trim()"
              @click="applyTypeToPage"
            >
              Set type
            </v-btn>
          </div>
          <v-btn
            small
            outlined
            block
            @click="acceptPage"
          >
            <v-icon
              small
              left
            >
              mdi-check-all
            </v-icon>
            Mark all correct
          </v-btn>
        </v-card>
      </v-menu>
    </ReviewGridControls>

    <v-alert
      v-if="review.error.value"
      dense
      dismissible
      type="error"
      class="mx-2 my-1"
      @input="review.clearError()"
    >
      {{ review.error.value }}
    </v-alert>

    <div class="review-body px-2 pb-2">
      <ReviewDatasetsPanel
        v-if="view === 'datasets'"
        @open-dataset="openDataset"
      />
      <template v-else>
        <div
          v-if="readyDatasets === 0"
          class="d-flex flex-column align-center justify-center fill-height grey--text"
        >
          <v-icon
            large
            color="grey darken-1"
            class="mb-2"
          >
            mdi-database-outline
          </v-icon>
          <div v-if="review.loading.value">
            Loading annotations…
          </div>
          <template v-else>
            <div class="mb-3">
              No datasets are selected. Select one or more on the Datasets panel.
            </div>
            <v-btn
              small
              outlined
              @click="setView('datasets')"
            >
              <v-icon
                small
                left
              >
                mdi-database
              </v-icon>
              Datasets
            </v-btn>
          </template>
        </div>
        <div
          v-else-if="review.items.value.length === 0"
          class="d-flex flex-column align-center justify-center fill-height grey--text"
        >
          <v-icon
            large
            color="grey darken-1"
            class="mb-2"
          >
            mdi-image-search-outline
          </v-icon>
          <div v-if="review.loading.value">
            Loading annotations…
          </div>
          <div v-else-if="review.query.mode === 'type'">
            No annotations of {{ review.query.type ? `type "${review.query.type}"` : 'any type' }}
            at or above confidence {{ review.query.threshold }}.
          </div>
          <div v-else-if="!review.query.attributeKey">
            Pick an attribute and press Show.
          </div>
          <div v-else>
            No annotations carry attribute "{{ review.query.attributeKey }}"{{ review.query.attributeValue ? ` = ${review.query.attributeValue}` : '' }}.
          </div>
        </div>
        <ReviewGrid
          v-else
          :columns="review.grid.columns"
          :rows="review.grid.rows"
          @cell-size="grid.cellSize.value = $event"
        >
          <ReviewCell
            v-for="cell in cells"
            :key="cell.item.key"
            :src="review.chipStore.chips.value[cell.item.key] || null"
            :srcs="review.chipStore.sequences.value[cell.item.key] || null"
            :transform="review.chipStore.transforms.value[cell.item.key] || null"
            :transforms="review.chipStore.sequenceTransforms.value[cell.item.key] || null"
            :frames="cell.frames"
            :failure="review.chipStore.failures.value[cell.item.key] || null"
            :animate="true"
            :cycle-interval-ms="review.grid.cycleIntervalMs"
            :scale="cellScale"
            :type="cell.type"
            :confidence="cell.confidence"
            :pending="cell.pending"
            :title="cell.title"
            :subtitle="cell.subtitle"
            :attribute-text="cell.attributeText"
            :frame-count="cell.item.keyframeCount"
            :type-list-id="typeListId"
            @assign="review.assignType(cell.item, $event)"
            @accept="review.acceptType(cell.item)"
            @open="openItem(cell.item, $event)"
            @edit-geometry="applyGeometry(cell.item, $event)"
          />
        </ReviewGrid>
      </template>
    </div>

    <datalist :id="typeListId">
      <option
        v-for="type in review.types.value"
        :key="type"
        :value="type"
      />
    </datalist>
  </div>
</template>

<style lang="scss" scoped>
.review-page {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.review-toolbar {
  flex: 0 0 auto;
  gap: 4px 0;
}

.review-body {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  overflow: auto;
}

.query-field {
  max-width: 240px;
  font-size: 14px;
}

.type-field {
  max-width: 220px;
}

.scope-field {
  max-width: 200px;
}

.threshold-field {
  min-width: 320px;
}

.threshold-slider {
  min-width: 170px;
}

.threshold-number {
  max-width: 90px;
  font-size: 14px;
}

.sort-field {
  max-width: 240px;
  font-size: 14px;
}

.page-actions {
  min-width: 260px;
}

.page-type-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 3px 6px;
  font-size: 13px;
  color: #eee;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 3px;
  outline: none;

  &:focus {
    border-color: #90caf9;
  }
}
</style>
