<script lang="ts">
import {
  computed, defineComponent, ref, watch,
} from 'vue';
import { useScoring } from 'dive-common/use/useScoring';
import type { PRCurve } from 'dive-common/scoring/metrics';
import ScoringLineChart from './charts/ScoringLineChart.vue';
import type { ChartHover, ChartSeries } from './charts/chartTypes';

const OVERALL_COLOR = '#e0e0e0';

export default defineComponent({
  name: 'ScoringCurves',
  components: { ScoringLineChart },
  setup() {
    const scoring = useScoring();

    const mode = ref<'overall' | 'classes' | 'both'>('both');
    const threshold = ref<number>(scoring.currentFilters.value.default ?? 0.5);
    const applied = ref(false);
    watch(() => scoring.currentFilters.value.default, (value) => {
      if (value !== undefined) threshold.value = value;
    });

    const metrics = computed(() => scoring.metrics.value);
    const hasClasses = computed(() => Object.keys(metrics.value?.perClassPrCurves || {}).length > 0);

    watch(hasClasses, (value) => {
      if (!value) mode.value = 'overall';
    }, { immediate: true });

    function prSeries(name: string, curve: PRCurve, color: string, dashed = false): ChartSeries {
      return {
        name,
        color,
        dashed,
        points: curve.points.map((p) => ({
          x: p.recall,
          y: p.precision,
          meta: {
            threshold: p.confidence, F1: p.f1, TP: p.tp, FP: p.fp, FN: p.fn,
          },
        })),
      };
    }

    const prCurves = computed(() => {
      const out: { name: string; curve: PRCurve; color: string; dashed: boolean }[] = [];
      if (!metrics.value) return out;
      if (mode.value !== 'classes' && metrics.value.prCurve) {
        out.push({
          name: 'Overall', curve: metrics.value.prCurve, color: OVERALL_COLOR, dashed: mode.value === 'both',
        });
      }
      if (mode.value !== 'overall') {
        Object.entries(metrics.value.perClassPrCurves).forEach(([name, curve]) => {
          out.push({
            name, curve, color: scoring.classColor(name), dashed: false,
          });
        });
      }
      return out;
    });

    const prSeriesList = computed(() => prCurves.value.map((c) => prSeries(c.name, c.curve, c.color, c.dashed)));

    const rocSeries = computed<ChartSeries[]>(() => {
      const roc = metrics.value?.rocCurve;
      if (!roc) return [];
      return [{
        name: 'Overall',
        color: OVERALL_COLOR,
        points: roc.points
          .filter((p) => Number.isFinite(p.falseAlarmsPerFrame) && Number.isFinite(p.truePositiveRate))
          .map((p) => ({
            x: p.falseAlarmsPerFrame,
            y: p.truePositiveRate,
            meta: { threshold: p.confidence },
          })),
      }];
    });

    /** The curve point whose confidence sits at or just above the threshold */
    function pointAtThreshold(curve: PRCurve) {
      const candidates = curve.points.filter((p) => p.confidence >= threshold.value);
      if (candidates.length === 0) return null;
      return candidates.reduce((best, p) => (p.confidence < best.confidence ? p : best), candidates[0]);
    }

    const operatingPoints = computed(() => prCurves.value.map((c) => {
      const point = pointAtThreshold(c.curve);
      return {
        name: c.name,
        color: c.color,
        ap: c.curve.averagePrecision,
        maxF1: c.curve.maxF1,
        bestThreshold: c.curve.bestThreshold,
        point,
      };
    }));

    const selectedRecall = computed(() => {
      const overall = operatingPoints.value.find((o) => o.name === 'Overall') || operatingPoints.value[0];
      return overall?.point ? overall.point.recall : null;
    });

    const prMarkers = computed(() => operatingPoints.value
      .filter((o) => o.point && o.name !== 'Overall' && mode.value === 'classes')
      .map((o) => ({ x: o.point!.recall, label: o.name, color: o.color })));

    const rocSelected = computed(() => {
      const roc = metrics.value?.rocCurve;
      if (!roc) return null;
      const candidates = roc.points.filter((p) => p.confidence !== null && p.confidence >= threshold.value);
      if (candidates.length === 0) return null;
      const best = candidates.reduce((b, p) => ((p.confidence ?? 0) < (b.confidence ?? 0) ? p : b), candidates[0]);
      return best.falseAlarmsPerFrame;
    });

    function tooltip(h: ChartHover): string[] {
      const m = h.point.meta || {};
      return [
        h.series.name,
        `threshold ≥ ${Number(m.threshold ?? 0).toFixed(3)}`,
        `precision ${h.point.y.toFixed(3)}  recall ${h.point.x.toFixed(3)}`,
        `F1 ${Number(m.F1 ?? 0).toFixed(3)}  (TP ${m.TP}, FP ${m.FP}, FN ${m.FN})`,
      ];
    }

    function rocTooltip(h: ChartHover): string[] {
      const t = h.point.meta?.threshold;
      return [
        `threshold ≥ ${typeof t === 'number' ? t.toFixed(3) : 'n/a'}`,
        `Pd ${h.point.y.toFixed(3)} at ${h.point.x.toFixed(3)} false alarms / frame`,
      ];
    }

    function pickThreshold(h: ChartHover) {
      const t = h.point.meta?.threshold;
      if (typeof t === 'number' && Number.isFinite(t)) {
        threshold.value = Math.round(t * 1000) / 1000;
        applied.value = false;
      }
    }

    async function applyThreshold() {
      await scoring.applyConfidenceFilters({ default: threshold.value });
      applied.value = true;
    }

    const roc = computed(() => metrics.value?.rocCurve || null);

    return {
      mode,
      threshold,
      applied,
      hasClasses,
      prSeriesList,
      rocSeries,
      operatingPoints,
      selectedRecall,
      prMarkers,
      rocSelected,
      roc,
      tooltip,
      rocTooltip,
      pickThreshold,
      applyThreshold,
    };
  },
});
</script>

<template>
  <div class="px-2 scoring-curves">
    <div class="d-flex align-center flex-wrap controls">
      <v-btn-toggle
        v-model="mode"
        dense
        mandatory
        group
      >
        <v-btn
          value="overall"
          x-small
        >
          Consolidated
        </v-btn>
        <v-btn
          value="classes"
          x-small
          :disabled="!hasClasses"
        >
          Per class
        </v-btn>
        <v-btn
          value="both"
          x-small
          :disabled="!hasClasses"
        >
          Both
        </v-btn>
      </v-btn-toggle>
      <v-spacer />
      <span class="text-caption mr-2">Threshold</span>
      <v-slider
        v-model="threshold"
        :min="0"
        :max="1"
        :step="0.005"
        dense
        hide-details
        class="threshold-slider"
        @change="applied = false"
      />
      <v-text-field
        v-model.number="threshold"
        type="number"
        :min="0"
        :max="1"
        :step="0.01"
        dense
        hide-details
        outlined
        class="threshold-field ml-2"
      />
      <v-tooltip bottom>
        <template #activator="{ on }">
          <v-btn
            x-small
            outlined
            class="ml-2"
            :color="applied ? 'success' : 'primary'"
            v-on="on"
            @click="applyThreshold"
          >
            {{ applied ? 'Applied' : 'Use as confidence filter' }}
          </v-btn>
        </template>
        <span>Save this threshold as the base confidence filter of every scored dataset. Click a curve point to pick its threshold.</span>
      </v-tooltip>
    </div>
    <div class="d-flex flex-wrap charts">
      <div class="chart-col">
        <div class="chart-title">
          Precision / Recall
        </div>
        <ScoringLineChart
          :series="prSeriesList"
          x-label="Recall"
          y-label="Precision"
          :x-domain="[0, 1]"
          :y-domain="[0, 1.02]"
          :selected-x="selectedRecall"
          :markers="prMarkers"
          :tooltip="tooltip"
          :height="230"
          @click="pickThreshold"
        />
      </div>
      <div
        v-if="rocSeries.length"
        class="chart-col"
      >
        <div class="chart-title">
          Detection ROC
          <span
            v-if="roc && roc.meanPd !== null"
            class="text-caption grey--text"
          >(mean Pd {{ roc.meanPd.toFixed(3) }})</span>
        </div>
        <ScoringLineChart
          :series="rocSeries"
          x-label="False alarms per frame"
          y-label="Probability of detection"
          :y-domain="[0, 1.02]"
          :selected-x="rocSelected"
          :tooltip="rocTooltip"
          :height="230"
          @click="pickThreshold"
        />
      </div>
      <div class="operating-col">
        <table class="operating-table">
          <thead>
            <tr>
              <th>Curve</th>
              <th>AP</th>
              <th>Max F1</th>
              <th>@</th>
              <th>P @ t</th>
              <th>R @ t</th>
              <th>F1 @ t</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="o in operatingPoints"
              :key="o.name"
            >
              <td>
                <span
                  class="swatch"
                  :style="{ background: o.color }"
                />{{ o.name }}
              </td>
              <td>{{ o.ap === null ? 'n/a' : o.ap.toFixed(3) }}</td>
              <td>{{ o.maxF1 === null ? 'n/a' : o.maxF1.toFixed(3) }}</td>
              <td>{{ o.bestThreshold === null ? 'n/a' : o.bestThreshold.toFixed(2) }}</td>
              <td>{{ o.point ? o.point.precision.toFixed(3) : '—' }}</td>
              <td>{{ o.point ? o.point.recall.toFixed(3) : '—' }}</td>
              <td>{{ o.point ? o.point.f1.toFixed(3) : '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div class="text-caption grey--text mt-1">
          "@ t" columns read each curve at the selected threshold. Hover a curve for the
          threshold behind any point; click a point to select its threshold.
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.controls {
  gap: 4px;
}

.threshold-slider {
  max-width: 220px;
  min-width: 120px;
}

.threshold-field {
  max-width: 90px;
}

.threshold-field ::v-deep input {
  font-size: 12px;
  padding: 2px 0;
}

.charts {
  gap: 8px;
  align-items: flex-start;
}

.chart-col {
  flex: 1 1 320px;
  min-width: 280px;
}

.chart-title {
  font-size: 12px;
  font-weight: bold;
  color: #ccc;
  padding-left: 46px;
}

.operating-col {
  flex: 0 1 380px;
  min-width: 260px;
  padding-top: 18px;
}

.operating-table {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;

  th {
    text-align: right;
    color: #aaa;
    font-weight: normal;
    border-bottom: 1px solid #444;
    padding: 0 4px;
  }

  th:first-child {
    text-align: left;
  }

  td {
    text-align: right;
    padding: 1px 4px;
    font-variant-numeric: tabular-nums;
  }

  td:first-child {
    text-align: left;
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
