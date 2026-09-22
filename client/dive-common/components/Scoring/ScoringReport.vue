<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useScoring } from 'dive-common/use/useScoring';
import {
  formatMetric, METRIC_GROUPS, METRIC_DEFINITIONS, PRCurve,
} from 'dive-common/scoring/metrics';
import ScoringHeatmap from './charts/ScoringHeatmap.vue';
import ScoringLineChart from './charts/ScoringLineChart.vue';
import type { ChartSeries } from './charts/chartTypes';

const HEADLINE = ['precision', 'recall', 'f1_score', 'average_precision', 'mota', 'idf1', 'hota', 'mean_iou'];
const PER_CLASS_COLUMNS = ['true_positives', 'false_positives', 'false_negatives', 'precision', 'recall', 'f1_score', 'average_precision', 'ap50'];
const SWEEP_METRICS = ['f1_score', 'mota', 'idf1', 'hota'];
const SWEEP_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728'];
const MAX_ERROR_ROWS = 30;

/** Print-oriented rendering of the loaded run, light on white, no interaction. */
export default defineComponent({
  name: 'ScoringReport',
  components: { ScoringHeatmap, ScoringLineChart },
  setup() {
    const scoring = useScoring();
    const result = computed(() => scoring.result.value);
    const metrics = computed(() => scoring.metrics.value);
    const values = computed(() => metrics.value?.values || {});

    const headline = computed(() => HEADLINE
      .filter((key) => key in values.value)
      .map((key) => ({
        key,
        label: METRIC_DEFINITIONS[key]?.label || key,
        value: formatMetric(values.value[key], METRIC_DEFINITIONS[key]?.format || 'ratio'),
      })));

    const groups = computed(() => METRIC_GROUPS
      .filter((group) => !group.requires || (values.value[group.requires] || 0) > 0)
      .map((group) => ({
        name: group.name,
        rows: group.metrics
          .filter((m) => m.key in values.value)
          .map((m) => ({ key: m.key, label: m.label, value: formatMetric(values.value[m.key], m.format) })),
      }))
      .filter((group) => group.rows.length > 0));

    const paramRows = computed(() => Object.entries(result.value?.params || {})
      .filter(([key, value]) => !(key === 'labelSynonyms' && !value))
      .map(([key, value]) => ({ key, value: String(value) })));

    const classRows = computed(() => Object.entries(metrics.value?.perClass || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, m]) => ({
        name,
        cells: PER_CLASS_COLUMNS.map((key) => formatMetric(m[key], METRIC_DEFINITIONS[key]?.format || 'ratio')),
      })));
    const classColumns = PER_CLASS_COLUMNS.map((key) => METRIC_DEFINITIONS[key]?.label || key);

    function prSeries(name: string, curve: PRCurve, color: string, dashed = false): ChartSeries {
      return {
        name,
        color,
        dashed,
        points: curve.points.map((p) => ({ x: p.recall, y: p.precision, meta: { threshold: p.confidence } })),
      };
    }

    const prSeriesList = computed<ChartSeries[]>(() => {
      const m = metrics.value;
      if (!m) return [];
      const out: ChartSeries[] = [];
      if (m.prCurve) out.push(prSeries('Overall', m.prCurve, '#333333', Object.keys(m.perClassPrCurves).length > 0));
      Object.entries(m.perClassPrCurves).forEach(([name, curve]) => {
        out.push(prSeries(name, curve, scoring.classColor(name)));
      });
      return out;
    });

    const rocSeries = computed<ChartSeries[]>(() => {
      const roc = metrics.value?.rocCurve;
      if (!roc) return [];
      return [{
        name: 'Overall',
        color: '#333333',
        points: roc.points.map((p) => ({ x: p.falseAlarmsPerFrame, y: p.truePositiveRate })),
      }];
    });

    const apRows = computed(() => {
      const m = metrics.value;
      if (!m) return [];
      const rows = [];
      if (m.prCurve) {
        rows.push({
          name: 'Overall', ap: m.prCurve.averagePrecision, maxF1: m.prCurve.maxF1, at: m.prCurve.bestThreshold,
        });
      }
      Object.entries(m.perClassPrCurves).forEach(([name, c]) => {
        rows.push({
          name, ap: c.averagePrecision, maxF1: c.maxF1, at: c.bestThreshold,
        });
      });
      return rows;
    });

    const sweep = computed(() => metrics.value?.sweep || null);
    const sweepCurveName = computed(() => {
      const names = Object.keys(sweep.value?.curves || {});
      return names.find((n) => n === 'overall' || n === 'default') || names[0] || '';
    });
    const sweepSeries = computed<ChartSeries[]>(() => {
      const curve = sweep.value?.curves[sweepCurveName.value];
      if (!curve) return [];
      return SWEEP_METRICS
        .filter((key) => curve.metrics[key])
        .map((key, i) => ({
          name: METRIC_DEFINITIONS[key]?.label || key,
          color: SWEEP_COLORS[i % SWEEP_COLORS.length],
          points: curve.thresholds.map((t, j) => ({ x: t, y: curve.metrics[key][j] ?? 0 })),
        }));
    });
    const sweepRows = computed(() => Object.entries(sweep.value?.curves || {}).map(([name, c]) => ({
      name,
      idf1: c.best.idf1,
      idf1Thresh: c.best.idf1Thresh,
      mota: c.best.mota,
      motaThresh: c.best.motaThresh,
    })));

    const counts = computed(() => {
      const out = { tp: 0, fp: 0, fn: 0 };
      scoring.matches.value.forEach((m) => { out[m.status] += 1; });
      return out;
    });
    const errorRows = computed(() => scoring.matches.value
      .filter((m) => m.status !== 'tp')
      .sort((a, b) => (a.status === b.status ? b.confidence - a.confidence : a.status.localeCompare(b.status)))
      .slice(0, MAX_ERROR_ROWS)
      .map((m) => ({
        sequence: scoring.datasetName(result.value?.pairs[m.sequence]?.computed.datasetId || ''),
        frame: m.frame,
        status: m.status === 'fp' ? 'False positive' : 'Missed',
        id: m.status === 'fp' ? m.computedId : m.gtId,
        klass: m.status === 'fp' ? m.computedClass : m.gtClass,
        confidence: m.status === 'fp' ? m.confidence.toFixed(3) : '',
      })));

    return {
      scoring,
      result,
      metrics,
      headline,
      groups,
      paramRows,
      classRows,
      classColumns,
      prSeriesList,
      rocSeries,
      apRows,
      sweep,
      sweepCurveName,
      sweepSeries,
      sweepRows,
      counts,
      errorRows,
      multiSequence: computed(() => (result.value?.pairs.length || 0) > 1),
      fmt: (v: number | null) => (v === null || v === undefined ? 'n/a' : v.toFixed(3)),
    };
  },
});
</script>

<template>
  <div
    v-if="result && metrics"
    class="scoring-report"
  >
    <h1>Scoring report</h1>
    <div class="subtitle">
      {{ result.title }} · {{ new Date(result.created).toLocaleString() }}
    </div>

    <section>
      <h2>Sequences</h2>
      <table class="report-table">
        <thead>
          <tr><th>#</th><th>Computed annotations</th><th>Ground truth</th></tr>
        </thead>
        <tbody>
          <tr
            v-for="(pair, i) in result.pairs"
            :key="i"
          >
            <td>{{ i + 1 }}</td>
            <td>{{ scoring.sourceLabel(pair.computed) }}</td>
            <td>{{ scoring.sourceLabel(pair.truth) }}</td>
          </tr>
        </tbody>
      </table>
      <h2>Parameters</h2>
      <div class="param-grid">
        <span
          v-for="p in paramRows"
          :key="p.key"
        ><b>{{ p.key }}</b>: {{ p.value }}</span>
      </div>
    </section>

    <section>
      <h2>Summary</h2>
      <div class="headline-row">
        <div
          v-for="h in headline"
          :key="h.key"
          class="headline-card"
        >
          <div class="headline-value">
            {{ h.value }}
          </div>
          <div class="headline-label">
            {{ h.label }}
          </div>
        </div>
      </div>
      <div class="group-row">
        <table
          v-for="group in groups"
          :key="group.name"
          class="report-table compact"
        >
          <thead>
            <tr>
              <th colspan="2">
                {{ group.name }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in group.rows"
              :key="r.key"
            >
              <td>{{ r.label }}</td>
              <td class="num">
                {{ r.value }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="classRows.length">
      <h2>Per class</h2>
      <table class="report-table">
        <thead>
          <tr>
            <th>Class</th>
            <th
              v-for="c in classColumns"
              :key="c"
              class="num"
            >
              {{ c }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in classRows"
            :key="r.name"
          >
            <td>{{ r.name }}</td>
            <td
              v-for="(cell, i) in r.cells"
              :key="i"
              class="num"
            >
              {{ cell }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section
      v-if="metrics.confusionMatrix"
      class="keep-together"
    >
      <h2>Confusion matrix</h2>
      <ScoringHeatmap
        :row-labels="metrics.confusionMatrix.classNames"
        :col-labels="metrics.confusionMatrix.classNames"
        :counts="metrics.confusionMatrix.matrix"
        :fractions="metrics.confusionMatrix.normalized"
        :background-index="metrics.confusionMatrix.classNames.indexOf('background')"
        light
      />
      <div class="note">
        Rows are truth classes, columns are computed classes; the background row holds
        false positives and the background column missed objects.
      </div>
    </section>

    <section
      v-if="prSeriesList.length"
      class="keep-together"
    >
      <h2>Precision / recall</h2>
      <div class="chart-row">
        <div class="chart-box">
          <ScoringLineChart
            :series="prSeriesList"
            x-label="Recall"
            y-label="Precision"
            :x-domain="[0, 1]"
            :y-domain="[0, 1.02]"
            :height="260"
            light
          />
        </div>
        <div
          v-if="rocSeries.length"
          class="chart-box"
        >
          <ScoringLineChart
            :series="rocSeries"
            x-label="False alarms per frame"
            y-label="Probability of detection"
            :y-domain="[0, 1.02]"
            :height="260"
            light
          />
        </div>
      </div>
      <table class="report-table compact">
        <thead>
          <tr>
            <th>Curve</th><th class="num">
              AP
            </th><th class="num">
              Max F1
            </th><th class="num">
              at threshold
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in apRows"
            :key="r.name"
          >
            <td>{{ r.name }}</td>
            <td class="num">
              {{ fmt(r.ap) }}
            </td>
            <td class="num">
              {{ fmt(r.maxF1) }}
            </td>
            <td class="num">
              {{ fmt(r.at) }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section
      v-if="sweep"
      class="keep-together"
    >
      <h2>Threshold sweep ({{ sweepCurveName }})</h2>
      <div class="chart-box">
        <ScoringLineChart
          :series="sweepSeries"
          x-label="Confidence threshold"
          y-label="Score"
          :x-domain="[0, 1]"
          :height="240"
          light
        />
      </div>
      <table class="report-table compact">
        <thead>
          <tr>
            <th>Curve</th><th class="num">
              Best IDF1
            </th><th class="num">
              at
            </th><th class="num">
              Best MOTA
            </th><th class="num">
              at
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in sweepRows"
            :key="r.name"
          >
            <td>{{ r.name }}</td>
            <td class="num">
              {{ fmt(r.idf1) }}
            </td>
            <td class="num">
              {{ fmt(r.idf1Thresh) }}
            </td>
            <td class="num">
              {{ fmt(r.mota) }}
            </td>
            <td class="num">
              {{ fmt(r.motaThresh) }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="counts.tp + counts.fp + counts.fn > 0">
      <h2>Errors</h2>
      <div class="note">
        {{ counts.tp }} matched · {{ counts.fp }} false positives · {{ counts.fn }} missed.
        Highest-confidence false positives and the missed objects, up to {{ errorRows.length }} rows.
      </div>
      <table class="report-table compact">
        <thead>
          <tr>
            <th v-if="multiSequence">
              Sequence
            </th>
            <th class="num">
              Frame
            </th><th>Status</th><th class="num">
              Id
            </th><th>Class</th><th class="num">
              Confidence
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(r, i) in errorRows"
            :key="i"
          >
            <td v-if="multiSequence">
              {{ r.sequence }}
            </td>
            <td class="num">
              {{ r.frame }}
            </td>
            <td>{{ r.status }}</td>
            <td class="num">
              {{ r.id }}
            </td>
            <td>{{ r.klass }}</td>
            <td class="num">
              {{ r.confidence }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.scoring-report {
  background: white;
  color: #111;
  padding: 24px 32px;
  max-width: 1000px;
  font-size: 12px;

  h1 {
    font-size: 22px;
    margin: 0;
  }

  h2 {
    font-size: 15px;
    margin: 18px 0 6px;
    border-bottom: 1px solid #999;
  }

  .subtitle {
    color: #444;
    margin-bottom: 8px;
  }

  section {
    margin-bottom: 12px;
  }

  .keep-together {
    break-inside: avoid;
  }

  .note {
    color: #444;
    margin: 4px 0;
  }

  .param-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 16px;
  }

  .headline-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .headline-card {
    border: 1px solid #bbb;
    border-radius: 4px;
    padding: 4px 12px;
    min-width: 80px;
    text-align: center;

    .headline-value {
      font-size: 17px;
      font-weight: bold;
    }

    .headline-label {
      font-size: 10px;
      color: #555;
    }
  }

  .group-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: flex-start;

    .report-table {
      flex: 0 0 auto;
      width: 230px;
    }
  }

  .report-table {
    border-collapse: collapse;
    margin-bottom: 6px;

    th,
    td {
      border: 1px solid #ccc;
      padding: 2px 8px;
      text-align: left;
    }

    th {
      background: #eee;
    }

    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    &.compact td,
    &.compact th {
      padding: 1px 8px;
    }
  }

  .chart-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .chart-box {
    flex: 1 1 380px;
    min-width: 320px;
    max-width: 480px;
  }
}
</style>
