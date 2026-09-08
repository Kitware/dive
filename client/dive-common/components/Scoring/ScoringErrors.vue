<script lang="ts">
import {
  computed, defineComponent, PropType, ref, watch,
} from 'vue';
import { useScoring } from 'dive-common/use/useScoring';
import { perFrameErrorCounts, ScoringMatch } from 'dive-common/scoring/metrics';
import type { ScoringSource } from 'dive-common/scoring/types';
import ScoringLineChart from './charts/ScoringLineChart.vue';
import type { ChartHover, ChartSeries } from './charts/chartTypes';

export interface ErrorFilter {
  status: 'tp' | 'fp' | 'fn' | null;
  gtClass: string | null;
  computedClass: string | null;
}

const STATUS_LABEL: Record<string, string> = { tp: 'Match', fp: 'False positive', fn: 'Missed' };
const STATUS_COLOR: Record<string, string> = { tp: '#4caf50', fp: '#e53935', fn: '#ff9800' };

export default defineComponent({
  name: 'ScoringErrors',
  components: { ScoringLineChart },
  props: {
    filter: {
      type: Object as PropType<ErrorFilter | null>,
      default: null,
    },
  },
  setup(props, { emit }) {
    const scoring = useScoring();

    const status = ref<'all' | 'tp' | 'fp' | 'fn'>('all');
    const klass = ref<string>('');
    const sequence = ref<number>(0);
    const showMatches = ref(false);

    watch(() => props.filter, (f) => {
      if (!f) return;
      status.value = f.status || 'all';
      klass.value = f.gtClass || f.computedClass || '';
    });

    const pairs = computed(() => scoring.result.value?.pairs || []);
    const sequenceItems = computed(() => pairs.value.map((p, i) => ({
      value: i,
      text: scoring.datasetName(p.computed.datasetId),
    })));
    watch(pairs, () => { sequence.value = 0; });

    const matches = computed(() => scoring.matches.value);
    const classes = computed(() => {
      const names = new Set<string>();
      matches.value.forEach((m) => {
        if (m.gtClass) names.add(m.gtClass);
        if (m.computedClass) names.add(m.computedClass);
      });
      return Array.from(names).sort();
    });

    const filtered = computed(() => matches.value.filter((m) => {
      if (status.value !== 'all' && m.status !== status.value) return false;
      if (status.value === 'all' && !showMatches.value && m.status === 'tp') return false;
      if (klass.value && m.gtClass !== klass.value && m.computedClass !== klass.value) return false;
      if (props.filter && props.filter.status === 'tp' && props.filter.gtClass && props.filter.computedClass
        && status.value === 'tp') {
        return m.gtClass === props.filter.gtClass && m.computedClass === props.filter.computedClass;
      }
      return true;
    }));

    const counts = computed(() => {
      const out = { tp: 0, fp: 0, fn: 0 };
      matches.value.forEach((m) => { out[m.status] += 1; });
      return out;
    });

    const frameSeries = computed<ChartSeries[]>(() => {
      const perFrame = perFrameErrorCounts(matches.value.filter((m) => m.sequence === sequence.value
        && (!klass.value || m.gtClass === klass.value || m.computedClass === klass.value)));
      if (!perFrame.length) return [];
      const build = (key: 'tp' | 'fp' | 'fn') => ({
        name: STATUS_LABEL[key],
        color: STATUS_COLOR[key],
        points: perFrame.map((f) => ({ x: f.frame, y: f[key] })),
      });
      const series = [build('fp'), build('fn')];
      if (showMatches.value) series.unshift(build('tp'));
      return series;
    });

    function frameTooltip(h: ChartHover): string[] {
      return [`frame ${h.point.x}`, `${h.series.name}: ${h.point.y}`];
    }

    function datasetFor(m: ScoringMatch) {
      return pairs.value[m.sequence]?.computed.datasetId || '';
    }

    function sequenceName(m: ScoringMatch) {
      const id = datasetFor(m);
      return id ? scoring.datasetName(id) : `#${m.sequence}`;
    }

    function openSource(m: ScoringMatch) {
      const source = pairs.value[m.sequence]?.computed;
      if (source) emit('open-viewer', source);
    }

    const headers = computed(() => [
      ...(pairs.value.length > 1 ? [{ text: 'Sequence', value: 'sequence' }] : []),
      { text: 'Frame', value: 'frame', align: 'end' },
      { text: 'Status', value: 'status' },
      { text: 'Computed', value: 'computedId', align: 'end' },
      { text: 'Truth', value: 'gtId', align: 'end' },
      { text: 'Computed class', value: 'computedClass' },
      { text: 'Truth class', value: 'gtClass' },
      { text: 'Conf', value: 'confidence', align: 'end' },
      { text: 'IoU', value: 'iou', align: 'end' },
      {
        text: '', value: 'open', sortable: false, width: 32,
      },
    ]);

    const statusItems = [
      { value: 'all', text: 'Errors only' },
      { value: 'fp', text: 'False positives' },
      { value: 'fn', text: 'Missed' },
      { value: 'tp', text: 'Matches' },
    ];

    return {
      status,
      klass,
      sequence,
      sequenceItems,
      showMatches,
      classes,
      filtered,
      counts,
      frameSeries,
      frameTooltip,
      sequenceName,
      openSource,
      headers,
      statusItems,
      STATUS_LABEL,
      STATUS_COLOR,
    };
  },
});
</script>

<template>
  <div class="px-2 scoring-errors">
    <div
      v-if="counts.fp + counts.fn + counts.tp === 0"
      class="text-caption grey--text pa-2"
    >
      No per-object matches were stored for this result.
    </div>
    <template v-else>
      <div class="d-flex align-center flex-wrap controls">
        <v-select
          v-model="status"
          :items="statusItems"
          dense
          outlined
          hide-details
          class="status-select"
        />
        <v-select
          v-model="klass"
          :items="[{ value: '', text: 'All classes' }, ...classes.map((c) => ({ value: c, text: c }))]"
          dense
          outlined
          hide-details
          class="class-select"
        />
        <v-select
          v-if="sequenceItems.length > 1"
          v-model="sequence"
          :items="sequenceItems"
          dense
          outlined
          hide-details
          label="Chart sequence"
          class="class-select"
        />
        <v-checkbox
          v-model="showMatches"
          dense
          hide-details
          label="Show matches"
          class="mt-0 ml-2"
        />
        <v-spacer />
        <span class="text-caption">
          <span :style="{ color: STATUS_COLOR.tp }">{{ counts.tp }} matched</span> ·
          <span :style="{ color: STATUS_COLOR.fp }">{{ counts.fp }} false positives</span> ·
          <span :style="{ color: STATUS_COLOR.fn }">{{ counts.fn }} missed</span>
        </span>
      </div>
      <div class="chart-col">
        <ScoringLineChart
          :series="frameSeries"
          x-label="Frame"
          y-label="Objects"
          :tooltip="frameTooltip"
          :x-format="(v) => String(Math.round(v))"
          :y-format="(v) => String(Math.round(v))"
          :height="150"
          step
        />
      </div>
      <v-data-table
        :headers="headers"
        :items="filtered"
        dense
        :items-per-page="10"
        :footer-props="{ 'items-per-page-options': [10, 25, 100] }"
        class="error-table"
      >
        <template #[`item.sequence`]="{ item }">
          {{ sequenceName(item) }}
        </template>
        <template #[`item.status`]="{ item }">
          <span :style="{ color: STATUS_COLOR[item.status] }">{{ STATUS_LABEL[item.status] }}</span>
        </template>
        <template #[`item.computedId`]="{ item }">
          {{ item.computedId === null ? '—' : item.computedId }}
        </template>
        <template #[`item.gtId`]="{ item }">
          {{ item.gtId === null ? '—' : item.gtId }}
        </template>
        <template #[`item.confidence`]="{ item }">
          {{ item.status === 'fn' ? '—' : item.confidence.toFixed(3) }}
        </template>
        <template #[`item.iou`]="{ item }">
          {{ item.status === 'tp' ? item.iou.toFixed(3) : '—' }}
        </template>
        <template #[`item.open`]="{ item }">
          <v-tooltip bottom>
            <template #activator="{ on }">
              <v-btn
                icon
                x-small
                v-on="on"
                @click="openSource(item)"
              >
                <v-icon small>
                  mdi-open-in-new
                </v-icon>
              </v-btn>
            </template>
            <span>Open this sequence in the viewer</span>
          </v-tooltip>
        </template>
      </v-data-table>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.controls {
  gap: 8px;
}

.status-select,
.class-select {
  max-width: 200px;
}

.chart-col {
  max-width: 720px;
}

.error-table ::v-deep td,
.error-table ::v-deep th {
  font-size: 12px !important;
  height: 24px !important;
}
</style>
