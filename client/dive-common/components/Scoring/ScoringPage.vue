<script lang="ts">
import {
  computed, defineComponent, nextTick, onMounted, PropType, ref, watch,
} from 'vue';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { createScoringService, provideScoring } from 'dive-common/use/useScoring';
import { formatMetric } from 'dive-common/scoring/metrics';
import {
  downloadTextFile, exportFilename, resultToCsv, resultToJson,
} from 'dive-common/scoring/export';
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
 * Platform shells own routing; this emits `open-viewer` with a dataset id.
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

    const tab = ref('summary');
    const showParams = ref(false);
    const errorFilter = ref<ErrorFilter | null>(null);
    const reportMode = ref(false);
    const exporting = ref(false);

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
    async function printReport() {
      const result = scoring.result.value;
      if (!result) return;
      exporting.value = true;
      document.documentElement.classList.add('scoring-print');
      try {
        await nextTick();
        if (api.exportScoringPdf) {
          await api.exportScoringPdf(exportFilename(result, 'pdf'));
        } else {
          window.print();
        }
      } finally {
        document.documentElement.classList.remove('scoring-print');
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
      if (ids.length) await scoring.setDatasets(ids);
    }

    onMounted(async () => {
      await scoring.refreshDatasets();
      scoring.refreshResults();
      await applyInitial(props.initialDatasetIds);
    });
    watch(() => props.initialDatasetIds, (ids) => { applyInitial(ids); });

    return {
      scoring,
      tab,
      tabs: TABS,
      showParams,
      errorFilter,
      paramsSummary,
      resultItems,
      removeResult,
      onConfusionFilter,
      reportMode,
      exporting,
      exportAs,
      printReport,
      canSavePdf,
      openViewer: (id: string) => emit('open-viewer', id),
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
          @click="reportMode = false"
        >
          <v-icon left>
            mdi-arrow-left
          </v-icon>
          Back to results
        </v-btn>
        <v-spacer />
        <span class="text-caption grey--text mr-3">
          {{ canSavePdf ? 'Saves the report below as a PDF.' : 'Choose "Save as PDF" in the print dialog.' }}
        </span>
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
    <v-row v-else>
      <v-col
        cols="12"
        lg="5"
        xl="4"
      >
        <v-card outlined>
          <v-card-title class="text-h6 py-2">
            <v-icon
              class="mr-2"
            >
              mdi-chart-box-outline
            </v-icon>
            Score annotations
          </v-card-title>
          <v-card-text>
            <ScoringPairsTable @open-viewer="openViewer" />
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
                @click="scoring.run()"
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

        <v-card
          outlined
          class="mt-3"
        >
          <v-card-title class="text-subtitle-1 py-2">
            Previous runs
            <v-spacer />
            <v-btn
              icon
              small
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
              class="text-caption grey--text px-4 pb-2"
            >
              No scoring runs stored yet.
            </div>
            <v-list-item
              v-for="item in resultItems"
              :key="item.id"
              :input-value="scoring.selectedResultId.value === item.id"
              color="primary"
              @click="scoring.selectResult(item.id)"
            >
              <v-list-item-content>
                <v-list-item-title>{{ item.title }}</v-list-item-title>
                <v-list-item-subtitle>
                  {{ item.when }} · F1 {{ item.f1 }} · {{ item.sequences }} sequence{{ item.sequences === 1 ? '' : 's' }}
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <v-btn
                  icon
                  x-small
                  @click.stop="removeResult(item.id)"
                >
                  <v-icon small>
                    mdi-delete-outline
                  </v-icon>
                </v-btn>
              </v-list-item-action>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>

      <v-col
        cols="12"
        lg="7"
        xl="8"
      >
        <v-card
          outlined
          class="results-card"
        >
          <template v-if="scoring.result.value">
            <div class="d-flex align-center px-3 pt-2">
              <div>
                <div class="text-subtitle-1">
                  {{ scoring.result.value.title }}
                </div>
                <div class="text-caption grey--text">
                  {{ new Date(scoring.result.value.created).toLocaleString() }}
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
                    @click="scoring.useResultSetup()"
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
            <div v-else>
              Add the sequences to score, choose which annotations are computed and which are
              truth for each, and press Score. Pick an earlier run on the left to review it.
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
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
.run-row {
  gap: 4px;
}

.report-mode {
  background: white;
  padding: 8px;
  border-radius: 4px;
}

.result-list {
  max-height: 50vh;
  overflow-y: auto;
}

.results-card {
  min-height: 60vh;
}

.result-tabs {
  border-bottom: 1px solid #444;
}

.results-body {
  padding: 8px 0;
}
</style>
