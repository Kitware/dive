<script lang="ts">
import {
  computed, defineComponent, ref, watch,
} from 'vue';
import { useScoring } from 'dive-common/use/useScoring';
import { METRIC_DEFINITIONS, type SweepCurve } from 'dive-common/scoring/metrics';
import type { ScoringFilterEstimator } from 'dive-common/scoring/types';
import ScoringLineChart from './charts/ScoringLineChart.vue';
import type { ChartHover, ChartSeries } from './charts/chartTypes';

const RATIO_METRICS = ['precision', 'recall', 'f1_score', 'mota', 'motp', 'idf1', 'hota', 'deta', 'assa'];
const COUNT_METRICS = ['true_positives', 'false_positives', 'false_negatives', 'id_switches', 'fragmentations', 'mostly_tracked', 'mostly_lost'];
const PALETTE = ['#4c9ac2', '#f4a261', '#2a9d8f', '#e76f51', '#e9c46a', '#a29bfe', '#fd79a8', '#81ecec', '#ffeaa7'];
const AGGREGATE_NAMES = ['overall', 'default'];

function estimateFilter(best: SweepCurve['best'], estimator: ScoringFilterEstimator): number | null {
  const idf1 = best.idf1Thresh ?? 0;
  const mota = best.motaThresh ?? 0;
  switch (estimator) {
    case 'min': return Math.min(idf1, mota);
    case 'avg': return (idf1 + mota) / 2;
    case 'avg_minus_1p': return Math.max((idf1 + mota) / 2 - 0.01, 0);
    case 'idf1': return idf1;
    case 'mota': return mota;
    case 'none':
    default: return null;
  }
}

export default defineComponent({
  name: 'ScoringSweep',
  components: { ScoringLineChart },
  setup() {
    const scoring = useScoring();

    const sweep = computed(() => scoring.metrics.value?.sweep || null);
    const curveNames = computed(() => {
      const names = Object.keys(sweep.value?.curves || {});
      return [
        ...names.filter((n) => AGGREGATE_NAMES.includes(n)),
        ...names.filter((n) => !AGGREGATE_NAMES.includes(n)).sort(),
      ];
    });
    const curveName = ref<string>('');
    watch(curveNames, (names) => {
      if (!names.includes(curveName.value)) curveName.value = names[0] || '';
    }, { immediate: true });

    const curve = computed(() => (sweep.value && curveName.value ? sweep.value.curves[curveName.value] : null));
    const availableMetrics = computed(() => Object.keys(curve.value?.metrics || {}));
    const selectedMetrics = ref<string[]>(['f1_score', 'mota', 'idf1', 'hota']);
    const metricItems = computed(() => availableMetrics.value.map((key) => ({
      value: key,
      text: METRIC_DEFINITIONS[key]?.label || key,
    })));

    function seriesFor(keys: string[]): ChartSeries[] {
      const c = curve.value;
      if (!c) return [];
      return keys
        .filter((key) => c.metrics[key])
        .map((key, i) => ({
          name: METRIC_DEFINITIONS[key]?.label || key,
          color: PALETTE[i % PALETTE.length],
          points: c.thresholds.map((t, j) => ({ x: t, y: c.metrics[key][j] ?? 0, meta: { metric: key } }))
            .filter((p) => Number.isFinite(p.y)),
        }));
    }

    const ratioSeries = computed(() => seriesFor(selectedMetrics.value.filter((k) => !COUNT_METRICS.includes(k))));
    const countSeries = computed(() => seriesFor(selectedMetrics.value.filter((k) => COUNT_METRICS.includes(k))));

    const markers = computed(() => {
      const c = curve.value;
      if (!c) return [];
      const out = [];
      if (c.best.idf1Thresh !== null) out.push({ x: c.best.idf1Thresh, label: `best IDF1 ${c.best.idf1?.toFixed(2)}`, color: '#a29bfe' });
      if (c.best.motaThresh !== null && c.best.motaThresh !== c.best.idf1Thresh) {
        out.push({ x: c.best.motaThresh, label: `best MOTA ${c.best.mota?.toFixed(2)}`, color: '#2a9d8f' });
      }
      return out;
    });

    const currentFilter = computed(() => {
      const filters = scoring.currentFilters.value;
      if (AGGREGATE_NAMES.includes(curveName.value)) return filters.default ?? null;
      return filters[curveName.value] ?? filters.default ?? null;
    });

    function tooltip(h: ChartHover): string[] {
      const c = curve.value;
      if (!c) return [];
      const idx = c.thresholds.indexOf(h.point.x);
      const lines = [`threshold ≥ ${h.point.x.toFixed(2)}`];
      const keys = [...ratioSeries.value, ...countSeries.value].map((s) => String(s.points[0]?.meta?.metric));
      keys.forEach((key) => {
        const v = c.metrics[key]?.[idx];
        let text = 'n/a';
        if (v !== null && v !== undefined) {
          text = COUNT_METRICS.includes(key) ? String(v) : v.toFixed(3);
        }
        lines.push(`${METRIC_DEFINITIONS[key]?.label || key}: ${text}`);
      });
      return lines;
    }

    const estimator = ref<ScoringFilterEstimator>(scoring.result.value?.params.filterEstimator || 'min');
    watch(() => scoring.result.value, (r) => {
      if (r) estimator.value = r.params.filterEstimator || 'min';
    });

    const recommended = computed(() => {
      const s = sweep.value;
      if (!s) return [];
      const rows = Object.entries(s.curves)
        .filter(([name]) => name !== 'overall')
        .map(([name, c]) => ({
          name: name === 'default' ? 'default' : name,
          color: name === 'default' ? '#ccc' : scoring.classColor(name),
          threshold: estimateFilter(c.best, estimator.value),
          idf1: c.best.idf1,
          idf1Thresh: c.best.idf1Thresh,
          mota: c.best.mota,
          motaThresh: c.best.motaThresh,
        }));
      const named = rows.filter((r) => r.threshold !== null && r.name !== 'default');
      // Mirror the tool's dive.config.json: unlisted classes fall back to the
      // least aggressive per-class value rather than going unfiltered.
      if (named.length && !rows.some((r) => r.name === 'default')) {
        const minimum = Math.min(...named.map((r) => r.threshold as number));
        if (minimum > 0) {
          rows.push({
            name: 'default', color: '#ccc', threshold: minimum, idf1: null, idf1Thresh: null, mota: null, motaThresh: null,
          });
        }
      }
      return rows;
    });

    const applied = ref(false);
    async function applyRecommended() {
      const filters: Record<string, number> = {};
      recommended.value.forEach((r) => {
        if (r.threshold !== null) filters[r.name] = Math.round(r.threshold * 1000) / 1000;
      });
      await scoring.applyConfidenceFilters(filters);
      applied.value = true;
    }
    watch([recommended, estimator], () => { applied.value = false; });

    const estimatorItems: { value: ScoringFilterEstimator; text: string }[] = [
      { value: 'min', text: 'min(IDF1, MOTA)' },
      { value: 'avg', text: 'average' },
      { value: 'avg_minus_1p', text: 'average − 0.01' },
      { value: 'idf1', text: 'best IDF1' },
      { value: 'mota', text: 'best MOTA' },
    ];

    return {
      sweep,
      curveNames,
      curveName,
      curve,
      metricItems,
      selectedMetrics,
      ratioSeries,
      countSeries,
      markers,
      currentFilter,
      tooltip,
      estimator,
      estimatorItems,
      recommended,
      applied,
      applyRecommended,
      RATIO_METRICS,
    };
  },
});
</script>

<template>
  <div class="px-2 scoring-sweep">
    <div
      v-if="!sweep"
      class="text-caption grey--text pa-2"
    >
      No threshold sweep in this result. Enable "Sweep thresholds" in the scoring parameters.
    </div>
    <template v-else>
      <div class="d-flex align-center flex-wrap controls">
        <v-select
          v-model="curveName"
          :items="curveNames"
          dense
          outlined
          hide-details
          label="Curve"
          class="curve-select"
        />
        <v-select
          v-model="selectedMetrics"
          :items="metricItems"
          dense
          outlined
          hide-details
          multiple
          small-chips
          deletable-chips
          label="Metrics"
          class="metric-select"
        />
        <v-spacer />
        <span
          v-if="currentFilter !== null"
          class="text-caption"
        >Current filter for this curve: {{ currentFilter.toFixed(2) }} (yellow line)</span>
      </div>
      <div class="d-flex flex-wrap charts">
        <div class="chart-col">
          <ScoringLineChart
            v-if="ratioSeries.length"
            :series="ratioSeries"
            x-label="Confidence threshold"
            y-label="Score"
            :x-domain="[0, 1]"
            :markers="markers"
            :selected-x="currentFilter"
            :tooltip="tooltip"
            :height="220"
          />
          <ScoringLineChart
            v-if="countSeries.length"
            :series="countSeries"
            x-label="Confidence threshold"
            y-label="Count"
            :x-domain="[0, 1]"
            :markers="markers"
            :selected-x="currentFilter"
            :tooltip="tooltip"
            :height="180"
            step
          />
        </div>
        <div class="recommend-col">
          <div class="d-flex align-center">
            <span class="text-body-2 font-weight-bold">Recommended confidence filters</span>
            <v-spacer />
            <v-select
              v-model="estimator"
              :items="estimatorItems"
              dense
              hide-details
              class="estimator-select"
            />
          </div>
          <table class="recommend-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>IDF1 @</th>
                <th>MOTA @</th>
                <th>Filter</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in recommended"
                :key="r.name"
              >
                <td>
                  <span
                    class="swatch"
                    :style="{ background: r.color }"
                  />{{ r.name }}
                </td>
                <td>{{ r.idf1 === null ? '—' : `${r.idf1.toFixed(2)} @ ${r.idf1Thresh === null ? '?' : r.idf1Thresh.toFixed(2)}` }}</td>
                <td>{{ r.mota === null ? '—' : `${r.mota.toFixed(2)} @ ${r.motaThresh === null ? '?' : r.motaThresh.toFixed(2)}` }}</td>
                <td class="font-weight-bold">
                  {{ r.threshold === null ? '—' : r.threshold.toFixed(2) }}
                </td>
              </tr>
            </tbody>
          </table>
          <v-btn
            x-small
            outlined
            class="mt-2"
            :color="applied ? 'success' : 'primary'"
            :disabled="recommended.length === 0"
            @click="applyRecommended"
          >
            {{ applied ? 'Applied to scored datasets' : 'Apply as confidence filters' }}
          </v-btn>
          <div class="text-caption grey--text mt-1">
            Per-class filters are saved on every scored dataset's confidence settings;
            the default filter applies to classes the sweep did not cover.
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.controls {
  gap: 8px;
}

.curve-select {
  max-width: 200px;
}

.metric-select {
  max-width: 520px;
  min-width: 260px;
}

.charts {
  gap: 8px;
  align-items: flex-start;
}

.chart-col {
  flex: 1 1 360px;
  min-width: 300px;
}

.recommend-col {
  flex: 0 1 420px;
  min-width: 280px;
  padding-top: 6px;
}

.estimator-select {
  max-width: 170px;
}

.recommend-table {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;

  th {
    color: #aaa;
    font-weight: normal;
    text-align: right;
    border-bottom: 1px solid #444;
    padding: 0 4px;
  }

  th:first-child,
  td:first-child {
    text-align: left;
  }

  td {
    text-align: right;
    padding: 1px 4px;
    font-variant-numeric: tabular-nums;
  }

  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    margin-right: 5px;
  }
}
</style>
