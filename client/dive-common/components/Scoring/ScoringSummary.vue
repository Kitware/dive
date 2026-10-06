<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { useScoring } from 'dive-common/use/useScoring';
import { formatMetric, METRIC_GROUPS } from 'dive-common/scoring/metrics';

const HEADLINE = ['precision', 'recall', 'f1_score', 'average_precision', 'mota', 'idf1', 'hota', 'mean_iou'];

export default defineComponent({
  name: 'ScoringSummary',
  setup() {
    const scoring = useScoring();
    const showText = ref(false);

    const values = computed(() => scoring.metrics.value?.values || {});

    const headline = computed(() => HEADLINE
      .filter((key) => key in values.value)
      .map((key) => {
        const def = METRIC_GROUPS.flatMap((g) => g.metrics).find((m) => m.key === key);
        return {
          key,
          label: def?.label || key,
          description: def?.description || '',
          value: formatMetric(values.value[key], def?.format || 'ratio'),
        };
      }));

    const groups = computed(() => METRIC_GROUPS
      .filter((group) => !group.requires || (values.value[group.requires] || 0) > 0)
      .map((group) => ({
        name: group.name,
        rows: group.metrics
          .filter((m) => m.key in values.value)
          .map((m) => ({
            key: m.key,
            label: m.label,
            description: m.description,
            value: formatMetric(values.value[m.key], m.format),
          })),
      }))
      .filter((group) => group.rows.length > 0));

    const config = computed(() => scoring.metrics.value?.config || null);
    const result = computed(() => scoring.result.value);

    return {
      scoring,
      headline,
      groups,
      config,
      result,
      showText,
    };
  },
});
</script>

<template>
  <div class="scoring-summary px-2">
    <div class="d-flex flex-wrap headline-row">
      <v-tooltip
        v-for="item in headline"
        :key="item.key"
        bottom
        open-delay="300"
      >
        <template #activator="{ on }">
          <div
            class="headline-card"
            v-on="on"
          >
            <div class="headline-value">
              {{ item.value }}
            </div>
            <div class="headline-label">
              {{ item.label }}
            </div>
          </div>
        </template>
        <span>{{ item.description }}</span>
      </v-tooltip>
    </div>
    <div
      v-if="result"
      class="text-caption grey--text px-1 pb-1"
    >
      <div
        v-for="(pair, i) in result.pairs"
        :key="i"
      >
        {{ scoring.sourceLabel(pair.computed) }} scored against {{ scoring.sourceLabel(pair.truth) }}
      </div>
      <span v-if="config">
        IoU ≥ {{ config.iouThreshold }} · conf ≥ {{ config.confidenceThreshold }} · {{ config.matchMode }} matching
      </span>
    </div>
    <div class="d-flex flex-wrap group-row">
      <div
        v-for="group in groups"
        :key="group.name"
        class="metric-group"
      >
        <div class="group-title">
          {{ group.name }}
        </div>
        <table class="metric-table">
          <tbody>
            <tr
              v-for="row in group.rows"
              :key="row.key"
            >
              <td class="metric-label">
                <v-tooltip
                  bottom
                  open-delay="400"
                >
                  <template #activator="{ on }">
                    <span v-on="on">{{ row.label }}</span>
                  </template>
                  <span>{{ row.description }}</span>
                </v-tooltip>
              </td>
              <td class="metric-value">
                {{ row.value }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div
      v-if="result && result.summaryText"
      class="px-1"
    >
      <a
        class="text-caption"
        @click="showText = !showText"
      >{{ showText ? 'Hide' : 'Show' }} tool output</a>
      <pre
        v-if="showText"
        class="summary-text"
      >{{ result.summaryText }}</pre>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.headline-row {
  gap: 6px;
  padding: 4px 0;
}

.headline-card {
  background: #272727;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 4px 12px;
  min-width: 84px;
  text-align: center;

  .headline-value {
    font-size: 18px;
    font-weight: bold;
  }

  .headline-label {
    font-size: 11px;
    color: #aaa;
  }
}

.group-row {
  gap: 12px;
  align-items: flex-start;
}

.metric-group {
  min-width: 190px;

  .group-title {
    font-weight: bold;
    font-size: 12px;
    color: #ccc;
    border-bottom: 1px solid #444;
    margin-bottom: 2px;
  }
}

.metric-table {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;

  .metric-label {
    color: #bbb;
    padding-right: 10px;
  }

  .metric-value {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
}

.summary-text {
  font-size: 11px;
  max-height: 300px;
  overflow: auto;
  background: #111;
  padding: 4px;
}
</style>
