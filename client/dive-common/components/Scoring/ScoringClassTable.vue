<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useScoring } from 'dive-common/use/useScoring';
import { formatMetric } from 'dive-common/scoring/metrics';

const COLUMNS: { key: string; text: string; format: 'ratio' | 'count' }[] = [
  { key: 'total_gt', text: 'Truth', format: 'count' },
  { key: 'total_computed', text: 'Computed', format: 'count' },
  { key: 'true_positives', text: 'TP', format: 'count' },
  { key: 'false_positives', text: 'FP', format: 'count' },
  { key: 'false_negatives', text: 'FN', format: 'count' },
  { key: 'precision', text: 'Precision', format: 'ratio' },
  { key: 'recall', text: 'Recall', format: 'ratio' },
  { key: 'f1_score', text: 'F1', format: 'ratio' },
  { key: 'average_precision', text: 'AP', format: 'ratio' },
  { key: 'ap50', text: 'AP@50', format: 'ratio' },
  { key: 'ap75', text: 'AP@75', format: 'ratio' },
  { key: 'ap50_95', text: 'AP@[.5:.95]', format: 'ratio' },
];

export default defineComponent({
  name: 'ScoringClassTable',
  setup() {
    const scoring = useScoring();

    const headers = computed(() => [
      { text: 'Class', value: 'name', sortable: true },
      ...COLUMNS.map((c) => ({
        text: c.text, value: c.key, sortable: true, align: 'end',
      })),
    ]);

    const rows = computed(() => {
      const perClass = scoring.metrics.value?.perClass || {};
      return Object.entries(perClass).map(([name, metrics]) => ({
        name,
        color: scoring.classColor(name),
        ...metrics,
      }));
    });

    function display(value: unknown, key: string) {
      const col = COLUMNS.find((c) => c.key === key);
      return formatMetric(typeof value === 'number' ? value : null, col?.format || 'ratio');
    }

    return {
      headers,
      rows,
      display,
      COLUMNS,
    };
  },
});
</script>

<template>
  <div class="px-2">
    <div
      v-if="rows.length === 0"
      class="text-caption grey--text pa-2"
    >
      Per-class metrics were not requested for this run. Enable "Per class" in the scoring parameters.
    </div>
    <div
      v-else
      class="class-table-scroll"
    >
      <v-data-table
        :headers="headers"
        :items="rows"
        dense
        disable-pagination
        hide-default-footer
        sort-by="f1_score"
        sort-desc
        class="class-table"
      >
        <template #[`item.name`]="{ item }">
          <span
            class="class-swatch"
            :style="{ background: item.color }"
          />
          {{ item.name }}
        </template>
        <template
          v-for="col in COLUMNS"
          #[`item.${col.key}`]="{ item }"
        >
          <span
            :key="col.key"
            class="tabular"
          >{{ display(item[col.key], col.key) }}</span>
        </template>
      </v-data-table>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.class-table-scroll {
  overflow-x: auto;
  max-width: 100%;
  min-width: 0;
}

.class-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 6px;
}

.tabular {
  font-variant-numeric: tabular-nums;
}

.class-table ::v-deep td,
.class-table ::v-deep th {
  font-size: 12px !important;
  height: 26px !important;
}
</style>
