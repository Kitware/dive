<script lang="ts">
import {
  computed, nextTick, defineComponent, onBeforeUnmount, onMounted, PropType, ref, watch,
} from 'vue';
import { onBeforeRouteLeave } from 'vue-router/composables';
import { debounce } from 'lodash';
import { clientSettings } from 'dive-common/store/settings';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { createReviewService, provideReview } from 'dive-common/use/useReview';
import { useReviewGrid } from 'dive-common/review/useReviewGrid';
import { cellScaleFor } from 'dive-common/review/gridSettings';
import { cycleIntervalFor } from 'dive-common/review/reviewItems';
import {
  holdReviewSession, sessionKey, shouldResume, takeReviewSession,
} from 'dive-common/review/reviewSession';
import { ReviewEntry, ReviewSortOrder } from 'dive-common/review/types';
import type { ViewerFocus } from 'dive-common/review/viewerNavigation';
import UserSettingsDialog from 'dive-common/components/UserSettingsDialog.vue';
import ReviewDatasetsPanel from './ReviewDatasetsPanel.vue';
import ReviewGrid from './ReviewGrid.vue';
import ReviewGridControls from './ReviewGridControls.vue';
import ReviewCell, { ReviewCellGeometryEdit, ReviewCellView } from './ReviewCell.vue';

const TYPE_LIST_ID = 'reviewTypeOptions';

/** Base footer height of a cell at scale 1 (type field plus caption). */
const CELL_FOOTER_BASE_PX = 48;

type ReviewView = 'results' | 'datasets';

const SORT_OPTIONS: { value: ReviewSortOrder; text: string }[] = [
  { value: 'confidence-desc', text: 'Confidence, high first' },
  { value: 'confidence-asc', text: 'Confidence, low first' },
  { value: 'dataset', text: 'Dataset, track id' },
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
    ReviewDatasetsPanel, ReviewGrid, ReviewGridControls, ReviewCell, UserSettingsDialog,
  },
  props: {
    initialDatasetIds: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },
  setup(props, { emit }) {
    const api = useApi();
    // Coming back to the page resumes where it was left, unless the library
    // sent a new selection (and nothing is unsaved).
    const held = takeReviewSession();
    const resumed = held && shouldResume(held, props.initialDatasetIds) ? held : null;
    if (held && !resumed) held.review.dispose();
    const review = resumed ? resumed.review : createReviewService({ api });
    const datasetKey = resumed ? resumed.datasetKey : sessionKey(props.initialDatasetIds);
    provideReview(review);
    const { prompt } = usePrompt();

    // Empty first visit opens Datasets; coming back with loaded data opens Results.
    const hasReady = review.datasets.value.some((d) => d.status === 'ready');
    const view = ref<ReviewView>(hasReady ? 'results' : 'datasets');
    if (hasReady) review.loadQueued();
    const pageTypeInput = ref('');
    const showSettings = ref(false);
    const typeField = ref<{ isMenuActive: boolean; activateMenu(): void; blur(): void } | null>(null);

    /** The type field's arrow opens its list, and closes it again on a second press. */
    function toggleTypeMenu() {
      const field = typeField.value;
      if (!field) return;
      if (field.isMenuActive) {
        field.isMenuActive = false;
        field.blur();
      } else {
        field.activateMenu();
      }
    }
    const gridActive = computed(() => view.value === 'results');
    const cellScale = computed(() => cellScaleFor(review.grid.columns, review.grid.rows));
    const footerPx = computed(() => Math.round(CELL_FOOTER_BASE_PX * cellScale.value));
    const grid = useReviewGrid<ReviewEntry>({
      items: review.entries,
      chipItemsOf: (entry) => entry.items,
      grid: review.grid,
      chipStore: review.chipStore,
      active: gridActive,
      footerPx,
      // The box is drawn over the chip (and follows edits), not into it.
      outline: '',
    });

    const showDatasetNames = computed(() => review.datasets.value.length > 1);
    const readyDatasets = computed(() => review.datasets.value.filter((d) => d.status === 'ready').length);

    /** Per-cell display data; carries dataRevision so edits re-render. */
    const cells = computed(() => {
      const revision = review.dataRevision.value;
      const { chipStore } = review;
      return grid.pageItems.value.map((entry) => {
        const [item] = entry.items;
        const current = review.currentType(item);
        const attribute = item.matchedAttribute;
        const attributeText = attribute
          ? `${attribute.key}${attribute.value === true ? '' : ` = ${String(attribute.value)}`}`
          : '';
        const fps = review.datasetFps(item.datasetId);
        const parent = review.parentOf(item.datasetId);
        const subtitleBits = [];
        if (showDatasetNames.value) subtitleBits.push(review.datasetName(parent));
        subtitleBits.push(`#${item.trackId}`);
        subtitleBits.push(item.frames.length > 1 ? `${item.keyframeCount} frames` : `frame ${item.primary.frame}`);
        const views: ReviewCellView[] = entry.items.map((view, index) => ({
          key: view.key,
          src: chipStore.chips.value[view.key] || null,
          srcs: chipStore.sequences.value[view.key] || null,
          transform: chipStore.transforms.value[view.key] || null,
          transforms: chipStore.sequenceTransforms.value[view.key] || null,
          frames: view.frames,
          failure: chipStore.failures.value[view.key] || null,
          frameCount: view.keyframeCount,
          label: entry.labels[index],
        }));
        return {
          entry,
          item,
          revision,
          views,
          type: current.type,
          confidence: current.confidence,
          pending: entry.items.some((view) => review.isPending(view)),
          title: `${review.datasetName(parent)} · track ${item.trackId} · frame ${item.primary.frame}`,
          subtitle: subtitleBits.join(' · '),
          attributeText,
          cycleIntervalMs: cycleIntervalFor(item.frames, fps, review.grid.cycleIntervalMs),
        };
      });
    });

    const typeItems = computed(() => [
      { value: '', text: 'Any type' },
      ...review.types.value.map((t) => ({ value: t, text: t })),
    ]);

    const countLabel = computed(() => {
      const count = review.entries.value.length;
      return `${count} entr${count === 1 ? 'y' : 'ies'}`;
    });

    function setView(next: ReviewView) {
      view.value = next;
      // Datasets picked on the Datasets view load only now, when results are wanted.
      if (next === 'results') review.loadQueued();
    }

    /** Open the viewer on the frame the chip is showing (its first frame otherwise). */
    function openItem(entry: ReviewEntry, frame?: number, viewIndex = 0) {
      const item = entry.items[viewIndex] ?? entry.items[0];
      const focus: ViewerFocus = { frame: frame ?? item.primary.frame, trackId: item.trackId };
      // A camera of a rig opens as the rig, which shows every camera.
      emit('open-viewer', review.parentOf(item.datasetId), focus);
    }

    function applyGeometry(entry: ReviewEntry, edit: ReviewCellGeometryEdit, viewIndex = 0) {
      const item = entry.items[viewIndex];
      if (!item) return;
      review.updateGeometry(item, edit.frame, {
        bounds: edit.bounds,
        polygons: edit.polygons,
        head: edit.head,
        tail: edit.tail,
      });
      grid.ensureVisible();
    }

    function addBox(entry: ReviewEntry, added: { frame: number; bounds: [number, number, number, number] }, viewIndex = 0) {
      const item = entry.items[viewIndex];
      if (!item) return;
      review.addKeyframe(item, added.frame, added.bounds);
      grid.ensureVisible();
    }

    /** Type edits apply to the track in every camera of the entry. */
    function assignEntryType(entry: ReviewEntry, type: string) {
      entry.items.forEach((item) => review.assignType(item, type));
    }

    function acceptEntry(entry: ReviewEntry) {
      entry.items.forEach((item) => review.acceptType(item));
    }

    function deleteEntry(entry: ReviewEntry) {
      entry.items.forEach((item) => review.deleteTrack(item));
    }

    function openDataset(datasetId: string) {
      emit('open-viewer', datasetId, {});
    }

    function applyTypeToPage() {
      const type = pageTypeInput.value.trim();
      if (!type) return;
      grid.pageItems.value.forEach((entry) => assignEntryType(entry, type));
    }

    function acceptPage() {
      grid.pageItems.value.forEach((entry) => acceptEntry(entry));
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

    const saveTooltipText = computed(() => {
      if (review.saving.value) return 'Saving changes...';
      const count = review.pendingCount.value;
      if (count === 0) return 'No unsaved changes';
      const changeLabel = count === 1 ? 'change' : 'changes';
      let tooltip = `Save ${count} ${changeLabel}`;
      if (clientSettings.autoSaveSettings.enabled) {
        tooltip += `. Auto-save is on (delay: ${clientSettings.autoSaveSettings.delaySeconds} seconds)`;
      }
      return tooltip;
    });

    // Three-way leave prompt: save, discard, or stay. The shared prompt service
    // is only two-button, so this dialog lives on the page.
    const leaveDialog = ref(false);
    const leavePendingCount = ref(0);
    let leaveResolve: ((choice: 'save' | 'discard' | 'cancel') => void) | null = null;

    function askLeaveUnsaved(count: number): Promise<'save' | 'discard' | 'cancel'> {
      leavePendingCount.value = count;
      leaveDialog.value = true;
      return new Promise((resolve) => {
        leaveResolve = resolve;
      });
    }

    function resolveLeave(choice: 'save' | 'discard' | 'cancel') {
      const resolve = leaveResolve;
      leaveResolve = null;
      leaveDialog.value = false;
      resolve?.(choice);
    }

    function onLeaveDialogInput(show: boolean) {
      if (!show) resolveLeave('cancel');
      else leaveDialog.value = true;
    }

    function onKeydown(event: KeyboardEvent) {
      grid.handleKeydown(event);
    }

    // Auto-save follows the annotator's setting: edits are written after the
    // configured delay, so leaving the page rarely finds anything unsaved.
    const autoSaveDelayMs = () => Math.max(1, Number(clientSettings.autoSaveSettings.delaySeconds) || 60) * 1000;
    let autoSave = debounce(() => {
      if (review.pendingCount.value > 0 && !review.saving.value) review.save();
    }, autoSaveDelayMs());
    watch(() => clientSettings.autoSaveSettings.delaySeconds, () => {
      autoSave.cancel();
      autoSave = debounce(() => {
        if (review.pendingCount.value > 0 && !review.saving.value) review.save();
      }, autoSaveDelayMs());
    });
    watch(review.pendingCount, (count, previous) => {
      if (clientSettings.autoSaveSettings.enabled && count > previous) autoSave();
    });
    watch(review.saving, (saving, wasSaving) => {
      if (wasSaving && !saving && clientSettings.autoSaveSettings.enabled && review.pendingCount.value > 0) autoSave();
    });

    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (review.pendingCount.value > 0) {
        event.preventDefault();
        // eslint-disable-next-line no-param-reassign
        event.returnValue = '';
      }
    }

    function holdSession() {
      holdReviewSession({
        review, view: view.value, page: grid.page.value, datasetKey,
      });
    }

    onBeforeRouteLeave(async (_to, _from, next) => {
      const pending = review.pendingCount.value;
      if (pending === 0) {
        holdSession();
        next();
        return;
      }
      // Cancel any pending auto-save so it does not race the user's choice.
      autoSave.cancel();
      const choice = await askLeaveUnsaved(pending);
      if (choice === 'cancel') {
        if (clientSettings.autoSaveSettings.enabled && review.pendingCount.value > 0) {
          autoSave();
        }
        next(false);
        return;
      }
      if (choice === 'save') {
        await review.save();
        if (review.pendingCount.value > 0) {
          // Save failed; the page already shows the error — stay put.
          next(false);
          return;
        }
      } else {
        await review.discardChanges();
      }
      holdSession();
      next();
    });

    async function applyInitial(ids: string[]) {
      if (ids.length === 0) return;
      await review.addDatasets(ids);
      if (review.datasets.value.some((d) => d.status === 'ready')) {
        view.value = 'results';
      }
    }

    onMounted(async () => {
      window.addEventListener('keydown', onKeydown);
      window.addEventListener('beforeunload', onBeforeUnload);
      if (resumed) {
        await nextTick();
        grid.goToPage(resumed.page);
      }
      await review.refreshAvailable();
      // A resumed session still takes a new library selection in when the
      // held key differs (pending edits are resolved on leave nowadays).
      if (!resumed || datasetKey !== sessionKey(props.initialDatasetIds)) {
        await applyInitial(props.initialDatasetIds);
      }
    });
    watch(() => props.initialDatasetIds, (ids) => { applyInitial(ids); });
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('beforeunload', onBeforeUnload);
      autoSave.cancel();
      grid.dispose();
      // Disposed here only when not handed over to the next visit.
      if (!takeReviewSession()) review.dispose();
      else {
        holdReviewSession({
          review, view: view.value, page: grid.page.value, datasetKey,
        });
      }
    });

    return {
      review,
      view,
      typeField,
      toggleTypeMenu,
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
      showSettings,
      setView,
      openItem,
      openDataset,
      applyGeometry,
      addBox,
      assignEntryType,
      acceptEntry,
      deleteEntry,
      applyTypeToPage,
      acceptPage,
      discard,
      saveTooltipText,
      leaveDialog,
      leavePendingCount,
      resolveLeave,
      onLeaveDialogInput,
      clientSettings,
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
            ref="typeField"
            :value="review.query.type"
            :items="typeItems"
            dense
            outlined
            hide-details
            class="query-field type-field mr-2"
            @change="review.query.type = $event || ''"
            @click:append="toggleTypeMenu"
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
      </template>

      <v-spacer />

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
        icon
        small
        class="mr-1"
        title="Settings (auto-save and more)"
        @click="showSettings = true"
      >
        <v-icon>mdi-cog</v-icon>
      </v-btn>
      <v-tooltip bottom>
        <template #activator="{ on }">
          <v-badge
            overlap
            bottom
            :content="review.pendingCount.value"
            :value="review.pendingCount.value > 0"
            offset-x="14"
            offset-y="12"
          >
            <v-btn
              small
              depressed
              color="primary"
              :disabled="review.pendingCount.value === 0"
              :loading="review.saving.value"
              v-on="on"
              @click="review.save()"
            >
              <v-icon
                small
                left
              >
                {{
                  clientSettings.autoSaveSettings.enabled
                    ? 'mdi-content-save-cog'
                    : 'mdi-content-save'
                }}
              </v-icon>
              Save
            </v-btn>
          </v-badge>
        </template>
        <span>{{ saveTooltipText }}</span>
      </v-tooltip>
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
            Pick an attribute to look for.
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
            :key="cell.entry.key"
            :views="cell.views"
            :animate="true"
            :cycle-interval-ms="cell.cycleIntervalMs"
            :scale="cellScale"
            :color="review.colorFor(cell.type)"
            :type="cell.type"
            :confidence="cell.confidence"
            :pending="cell.pending"
            :title="cell.title"
            :subtitle="cell.subtitle"
            :attribute-text="cell.attributeText"
            :type-options="review.knownTypes.value"
            @assign="assignEntryType(cell.entry, $event)"
            @accept="acceptEntry(cell.entry)"
            @delete="deleteEntry(cell.entry)"
            @open="(frame, index) => openItem(cell.entry, frame, index)"
            @edit-geometry="(edit, index) => applyGeometry(cell.entry, edit, index)"
            @add-box="(added, index) => addBox(cell.entry, added, index)"
          />
        </ReviewGrid>
      </template>
    </div>

    <UserSettingsDialog
      :value="showSettings"
      @input="showSettings = $event"
    />

    <v-dialog
      :value="leaveDialog"
      max-width="560"
      persistent
      @input="onLeaveDialogInput"
    >
      <v-card>
        <v-card-title style="word-break: normal;">
          Unsaved changes
        </v-card-title>
        <v-card-text>
          You have {{ leavePendingCount }} unsaved
          change{{ leavePendingCount === 1 ? '' : 's' }}.
          Save them before leaving, or discard them?
        </v-card-text>
        <v-card-actions>
          <v-btn
            text
            @click="resolveLeave('cancel')"
          >
            Stay
          </v-btn>
          <v-spacer />
          <v-btn
            text
            @click="resolveLeave('discard')"
          >
            Discard and Leave
          </v-btn>
          <v-btn
            color="primary"
            text
            :loading="review.saving.value"
            @click="resolveLeave('save')"
          >
            Save and Leave
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <datalist :id="typeListId">
      <option
        v-for="type in review.knownTypes.value"
        :key="type"
        :value="type"
      />
    </datalist>
  </div>
</template>

<style lang="scss" scoped>
// Every query control reads at the same size as the Results / Datasets
// buttons, whatever it currently shows.
$toolbar-font: 0.75rem;

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

.query-field,
.threshold-number,
.sort-field {
  font-size: $toolbar-font;

  ::v-deep input,
  ::v-deep .v-select__selection,
  ::v-deep .v-select__selection--comma,
  ::v-deep .v-label,
  ::v-deep .v-list-item__title {
    font-size: $toolbar-font;
    font-weight: 500;
    letter-spacing: 0.0892857143em;
  }
}

.query-field {
  max-width: 240px;
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
}

.sort-field {
  max-width: 240px;
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
