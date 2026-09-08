<script lang="ts">
import {
  computed, defineComponent, nextTick, onBeforeUnmount, onMounted, PropType, ref, watch,
} from 'vue';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { createScoringService, provideScoring } from 'dive-common/use/useScoring';
import { formatMetric } from 'dive-common/scoring/metrics';
import {
  downloadTextFile, exportFilename, resultToCsv, resultToJson,
} from 'dive-common/scoring/export';
import type { ScoringSource } from 'dive-common/scoring/types';
import ScoringReport from './ScoringReport.vue';
import ScoringPairsTable from './ScoringPairsTable.vue';
import ScoringParamsDialog from './ScoringParamsDialog.vue';
import ScoringSummary from './ScoringSummary.vue';
import ScoringClassTable from './ScoringClassTable.vue';
import ScoringConfusion from './ScoringConfusion.vue';
import ScoringCurves from './ScoringCurves.vue';
import ScoringSweep from './ScoringSweep.vue';
import ScoringErrors, { ErrorFilter } from './ScoringErrors.vue';

const TABS = [
  { key: 'summary', text: 'Summary' },
  { key: 'classes', text: 'Classes' },
  { key: 'confusion', text: 'Confusion' },
  { key: 'curves', text: 'Curves' },
  { key: 'sweep', text: 'Sweep' },
  { key: 'errors', text: 'Errors' },
];

/**
 * The scoring page: pick sequences and their computed/truth annotations, run
 * `viame score` on all of them as one job, and browse this or any earlier run.
 * Platform shells own routing; this emits `open-viewer` with a {@link ScoringSource}.
 */
export default defineComponent({
  name: 'ScoringPage',
  components: {
    ScoringPairsTable,
    ScoringParamsDialog,
    ScoringSummary,
    ScoringClassTable,
    ScoringConfusion,
    ScoringCurves,
    ScoringSweep,
    ScoringErrors,
    ScoringReport,
  },
  props: {
    initialDatasetIds: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },
  setup(props, { emit }) {
    const api = useApi();
    const scoring = createScoringService({ api });
    provideScoring(scoring);
    const { prompt } = usePrompt();

    const pageTab = ref('results');
    const tab = ref('summary');
    const showParams = ref(false);
    const errorFilter = ref<ErrorFilter | null>(null);
    const reportMode = ref(false);
    const exporting = ref(false);
    const printing = ref(false);

    async function saveText(filename: string, content: string, mime: string) {
      if (api.saveScoringExport) {
        await api.saveScoringExport({ filename, mime, content });
      } else {
        downloadTextFile(filename, content, mime);
      }
    }

    async function exportAs(kind: 'json' | 'csv' | 'pdf') {
      const result = scoring.result.value;
      if (!result || exporting.value) return;
      if (kind === 'pdf') {
        reportMode.value = true;
        return;
      }
      exporting.value = true;
      try {
        if (kind === 'json') {
          await saveText(exportFilename(result, 'json'), resultToJson(result), 'application/json');
        } else {
          await saveText(exportFilename(result, 'csv'), resultToCsv(result, scoring.metrics.value || undefined), 'text/csv');
        }
      } finally {
        exporting.value = false;
      }
    }

    // Electron's printToPDF renders the screen layout rather than print media,
    // so the chrome is hidden through a class as well as the print stylesheet.
    async function applyPrintStyles() {
      document.documentElement.classList.add('scoring-print');
      await nextTick();
    }

    function removePrintStyles() {
      document.documentElement.classList.remove('scoring-print');
    }

    function exitReportMode() {
      if (printing.value) return;
      reportMode.value = false;
      exporting.value = false;
      removePrintStyles();
    }

    async function printReport() {
      const result = scoring.result.value;
      if (!result || exporting.value) return;
      exporting.value = true;
      const printHooks = {
        onBeforePrint: async () => {
          printing.value = true;
          await applyPrintStyles();
        },
        onAfterPrint: () => {
          printing.value = false;
          removePrintStyles();
        },
      };
      try {
        if (api.exportScoringPdf) {
          const saved = await api.exportScoringPdf(exportFilename(result, 'pdf'), printHooks);
          if (saved) exitReportMode();
        } else {
          printing.value = true;
          await applyPrintStyles();
          window.print();
          printing.value = false;
          removePrintStyles();
        }
      } finally {
        removePrintStyles();
        exporting.value = false;
      }
    }

    const canSavePdf = computed(() => typeof api.exportScoringPdf === 'function');

    const paramsSummary = computed(() => {
      const p = scoring.params;
      const bits = [`IoU ≥ ${p.iouThreshold}`, `${p.matchMode} matching`];
      if (p.confidenceThreshold > 0) bits.push(`conf ≥ ${p.confidenceThreshold}`);
      if (p.perClass) bits.push('per class');
      if (p.tracking) bits.push('tracking');
      if (p.sweep) bits.push(`sweep ×${p.sweepInterval}`);
      return bits.join(' · ');
    });

    const resultItems = computed(() => scoring.results.value.map((r) => ({
      id: r.id,
      title: r.title,
      when: new Date(r.created).toLocaleString(),
      date: new Date(r.created).toLocaleDateString(),
      f1: formatMetric(r.headline.f1_score, 'ratio'),
      sequences: r.pairs.length,
    })));

    async function removeResult(id: string) {
      const ok = await prompt({
        title: 'Delete scoring result',
        text: 'Remove this scoring run?',
        confirm: true,
      });
      if (ok) await scoring.deleteResult(id);
    }

    function onConfusionFilter(filter: ErrorFilter | null) {
      errorFilter.value = filter;
      if (filter) tab.value = 'errors';
    }

    async function applyInitial(ids: string[]) {
      if (ids.length) {
        await scoring.setDatasets(ids);
        pageTab.value = 'newrun';
      }
    }

    async function selectRun(id: string) {
      await scoring.selectResult(id);
      pageTab.value = 'results';
    }

    function reuseSetup() {
      scoring.useResultSetup();
      pageTab.value = 'newrun';
    }

    async function runScoring() {
      await scoring.run();
      if (scoring.result.value) pageTab.value = 'results';
    }

    onMounted(async () => {
      await scoring.refreshDatasets();
      await scoring.refreshResults();
      if (!scoring.selectedResultId.value && scoring.results.value.length > 0) {
        await scoring.selectResult(scoring.results.value[0].id);
      }
      await applyInitial(props.initialDatasetIds);
    });
    watch(() => props.initialDatasetIds, (ids) => { applyInitial(ids); });

    function onReportKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') exitReportMode();
    }
    watch(reportMode, (active) => {
      if (active) document.addEventListener('keydown', onReportKeydown);
      else document.removeEventListener('keydown', onReportKeydown);
    });
    onBeforeUnmount(() => document.removeEventListener('keydown', onReportKeydown));

    return {
      scoring,
      pageTab,
      tab,
      tabs: TABS,
      showParams,
      errorFilter,
      paramsSummary,
      resultItems,
      removeResult,
      selectRun,
      reuseSetup,
      runScoring,
      onConfusionFilter,
      reportMode,
      exporting,
      printing,
      exportAs,
      printReport,
      exitReportMode,
      canSavePdf,
      openViewer: (source: ScoringSource) => emit('open-viewer', source, scoring.sourceLabel(source)),
    };
  },
});
</script>

<template>
  <div class="scoring-page">
    <v-alert
      v-if="!scoring.available.value"
      type="info"
      dense
      outlined
    >
      Scoring is not available on this platform.
    </v-alert>
    <div
      v-else-if="reportMode"
      class="report-mode"
    >
      <div class="d-flex align-center scoring-report-toolbar mb-2">
        <v-btn
          text
          color="grey darken-3"
          :disabled="printing"
          @click="exitReportMode"
        >
          <v-icon left>
            mdi-arrow-left
          </v-icon>
          Back to results
        </v-btn>
        <v-spacer />
        <span class="text-caption toolbar-hint mr-3">
          {{ canSavePdf ? 'Saves the report below as a PDF.' : 'Choose "Save as PDF" in the print dialog.' }}
        </span>
        <v-btn
          outlined
          color="grey darken-2"
          class="mr-2 toolbar-cancel"
          :disabled="printing"
          @click="exitReportMode"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          depressed
          :loading="exporting"
          @click="printReport"
        >
          <v-icon left>
            mdi-file-pdf-box
          </v-icon>
          {{ canSavePdf ? 'Save PDF' : 'Print' }}
        </v-btn>
      </div>
      <ScoringReport />
    </div>
    <div
      v-else
      class="scoring-layout"
    >
      <aside class="runs-rail">
        <v-card outlined>
          <v-card-title class="text-subtitle-2 py-2 px-3">
            Previous runs
            <v-spacer />
            <v-btn
              icon
              x-small
              :loading="scoring.loading.value"
              @click="scoring.refreshResults()"
            >
              <v-icon small>
                mdi-refresh
              </v-icon>
            </v-btn>
          </v-card-title>
          <v-list
            dense
            class="result-list"
          >
            <div
              v-if="resultItems.length === 0"
              class="text-caption grey--text px-3 pb-2"
            >
              No scoring runs stored yet.
            </div>
            <v-tooltip
              v-for="item in resultItems"
              :key="item.id"
              bottom
              open-delay="400"
            >
              <template #activator="{ on }">
                <v-list-item
                  :input-value="scoring.selectedResultId.value === item.id"
                  color="primary"
                  class="result-item"
                  v-on="on"
                  @click="selectRun(item.id)"
                >
                  <v-list-item-content>
                    <v-list-item-title>{{ item.title }}</v-list-item-title>
                    <v-list-item-subtitle>
                      F1 {{ item.f1 }} · {{ item.sequences }} seq · {{ item.date }}
                    </v-list-item-subtitle>
                  </v-list-item-content>
                  <v-list-item-action>
                    <v-btn
                      icon
                      x-small
                      color="error"
                      @click.stop="removeResult(item.id)"
                    >
                      <v-icon small>
                        mdi-delete-outline
                      </v-icon>
                    </v-btn>
                  </v-list-item-action>
                </v-list-item>
              </template>
              <span>{{ item.title }} · {{ item.when }}</span>
            </v-tooltip>
          </v-list>
        </v-card>
      </aside>

      <div class="scoring-main">
        <v-tabs
          v-model="pageTab"
          height="36"
          class="page-tabs mb-2"
        >
          <v-tab href="#results">
            Results
          </v-tab>
          <v-tab href="#newrun">
            New run
          </v-tab>
        </v-tabs>

        <v-card
          v-if="pageTab === 'results'"
          outlined
          class="results-card"
        >
          <template v-if="scoring.result.value">
            <div class="d-flex align-center px-3 pt-2 results-header">
              <div class="results-title-block">
                <div class="text-subtitle-1">
                  {{ scoring.result.value.title }}
                </div>
                <div class="text-caption grey--text">
                  {{ new Date(scoring.result.value.created).toLocaleString() }}
                </div>
                <div class="text-caption grey--text mt-1 result-sources">
                  <div
                    v-for="(pair, i) in scoring.result.value.pairs"
                    :key="i"
                    class="result-source-row"
                  >
                    <span
                      v-if="scoring.result.value.pairs.length > 1"
                      class="mr-1"
                    >{{ scoring.datasetName(pair.computed.datasetId) }}:</span>
                    <a @click="openViewer(pair.computed)">{{ scoring.sourceLabel(pair.computed) }}</a>
                    <span class="mx-1">vs</span>
                    <a @click="openViewer(pair.truth)">{{ scoring.sourceLabel(pair.truth) }}</a>
                  </div>
                </div>
              </div>
              <v-spacer />
              <v-menu offset-y>
                <template #activator="{ on }">
                  <v-btn
                    small
                    text
                    :loading="exporting"
                    v-on="on"
                  >
                    <v-icon
                      small
                      left
                    >
                      mdi-download
                    </v-icon>
                    Export
                  </v-btn>
                </template>
                <v-list dense>
                  <v-list-item @click="exportAs('json')">
                    <v-list-item-title>JSON (metrics, matches, setup)</v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="exportAs('csv')">
                    <v-list-item-title>CSV (summary and per-class tables)</v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="exportAs('pdf')">
                    <v-list-item-title>PDF report</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
              <v-tooltip bottom>
                <template #activator="{ on }">
                  <v-btn
                    small
                    text
                    v-on="on"
                    @click="reuseSetup"
                  >
                    <v-icon
                      small
                      left
                    >
                      mdi-restore
                    </v-icon>
                    Reuse setup
                  </v-btn>
                </template>
                <span>Load this run's sequences and parameters into the form</span>
              </v-tooltip>
            </div>
            <v-tabs
              v-model="tab"
              height="32"
              class="result-tabs"
            >
              <v-tab
                v-for="t in tabs"
                :key="t.key"
                :href="`#${t.key}`"
              >
                {{ t.text }}
              </v-tab>
            </v-tabs>
            <div class="results-body">
              <ScoringSummary v-if="tab === 'summary'" />
              <ScoringClassTable v-else-if="tab === 'classes'" />
              <ScoringConfusion
                v-else-if="tab === 'confusion'"
                @filter="onConfusionFilter"
              />
              <ScoringCurves v-else-if="tab === 'curves'" />
              <ScoringSweep v-else-if="tab === 'sweep'" />
              <ScoringErrors
                v-else-if="tab === 'errors'"
                :filter="errorFilter"
                @open-viewer="openViewer"
              />
            </div>
          </template>
          <v-card-text
            v-else
            class="text-body-2 grey--text"
          >
            <div v-if="scoring.running.value">
              Scoring is running; results appear here when the job finishes.
            </div>
            <div v-else-if="resultItems.length > 0">
              Select a run on the left to review it, or
              <a @click="pageTab = 'newrun'">configure a new run</a>.
            </div>
            <div v-else>
              No scoring runs yet.
              <a @click="pageTab = 'newrun'">Configure a new run</a>
              to score annotations against ground truth.
            </div>
          </v-card-text>
        </v-card>

        <v-card
          v-else
          outlined
          class="new-run-card"
        >
          <v-card-title class="text-h6 py-2">
            <v-icon class="mr-2">
              mdi-chart-box-outline
            </v-icon>
            Score annotations
          </v-card-title>
          <v-card-text>
            <div class="pairs-scroll">
              <ScoringPairsTable @open-viewer="openViewer" />
            </div>
            <div class="d-flex align-center mt-3 flex-wrap run-row">
              <v-btn
                small
                outlined
                @click="showParams = true"
              >
                <v-icon
                  small
                  left
                >
                  mdi-tune
                </v-icon>
                Parameters
              </v-btn>
              <span class="text-caption grey--text mx-2">{{ paramsSummary }}</span>
              <v-spacer />
              <v-btn
                depressed
                color="primary"
                :loading="scoring.running.value"
                :disabled="scoring.running.value || scoring.pairs.value.length === 0"
                @click="runScoring"
              >
                <v-icon left>
                  mdi-play
                </v-icon>
                Score
              </v-btn>
            </div>
            <div
              v-if="scoring.status.value"
              class="text-caption d-flex align-center mt-2"
            >
              <v-progress-circular
                indeterminate
                size="12"
                width="2"
                class="mr-2"
              />
              {{ scoring.status.value }}
            </div>
            <v-alert
              v-if="scoring.error.value"
              dense
              dismissible
              type="error"
              class="mt-2 mb-0"
              @input="scoring.clearError()"
            >
              {{ scoring.error.value }}
            </v-alert>
          </v-card-text>
        </v-card>
      </div>
    </div>
    <ScoringParamsDialog v-model="showParams" />
  </div>
</template>

<style lang="scss">
/* Printing the report view: only the report itself goes to paper */
@mixin report-only {
  .v-app-bar,
  .v-navigation-drawer,
  .v-footer,
  .scoring-report-toolbar {
    display: none !important;
  }

  .v-main {
    padding: 0 !important;
  }

  .v-application,
  .v-application .v-main__wrap,
  .scoring-page,
  .report-mode {
    background: white !important;
  }

  .scoring-page,
  .report-mode {
    padding: 0 !important;
  }
}

@media print {
  @include report-only;
}

html.scoring-print {
  @include report-only;
}
</style>

<style lang="scss" scoped>
.scoring-page {
  max-width: 100%;
  min-width: 0;
}

.scoring-layout {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  max-width: 100%;
  min-width: 0;
}

.scoring-main {
  flex: 1 1 auto;
  min-width: 0;
}

.runs-rail {
  flex: 0 0 248px;
  width: 248px;
  max-width: 248px;
  min-width: 0;
}

.page-tabs {
  border-bottom: 1px solid #444;
}

.run-row {
  gap: 4px;
}

.report-mode {
  background: white;
  padding: 8px;
  border-radius: 4px;
}

.scoring-report-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  background: white;
  border-bottom: 1px solid #ddd;
  padding: 4px 0 8px;
  flex-wrap: wrap;
  gap: 4px;

  .toolbar-hint {
    color: #666;
  }
}

.pairs-scroll {
  overflow-x: auto;
  max-width: 100%;
}

.result-list {
  max-height: calc(100vh - 180px);
  overflow-y: auto;
}

.result-item ::v-deep .v-list-item__content {
  min-width: 0;
}

.result-item ::v-deep .v-list-item__title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-item ::v-deep .v-list-item__subtitle {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.results-card,
.new-run-card {
  min-height: 60vh;
  min-width: 0;
  max-width: 100%;
}

.results-header {
  min-width: 0;
}

.results-title-block {
  min-width: 0;
  overflow: hidden;

  .text-subtitle-1 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.result-sources {
  line-height: 1.4;
}

.result-source-row {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-tabs {
  border-bottom: 1px solid #444;
}

.results-body {
  padding: 8px 0;
  overflow-x: auto;
  max-width: 100%;
  min-width: 0;
}

@media (max-width: 960px) {
  .scoring-layout {
    flex-direction: column;
  }

  .runs-rail {
    flex: 1 1 auto;
    width: 100%;
    max-width: 100%;
  }

  .result-list {
    max-height: 240px;
  }
}
</style>
