<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { useReview } from 'dive-common/use/useReview';
import { timelineStepPath, TimelineRow } from 'dive-common/review/statistics';

export default defineComponent({
  name: 'ReviewStatisticsPanel',
  setup() {
    const review = useReview();
    const search = ref('');
    const table = ref('categories');
    const { statistics } = review;
    const incomplete = computed(() => review.datasets.value.filter((dataset) => dataset.status !== 'ready').length);
    // A common vertical scale makes counts comparable across sequences.
    const peak = computed(() => statistics.value.timelines.reduce((max, row) => Math.max(max, ...row.bins), 1));
    function endLabel(row: TimelineRow) {
      return `${row.duration.toFixed(row.unit === 's' ? 1 : 0)} ${row.unit}`;
    }
    const headers = computed(() => (table.value === 'categories'
      ? [{ text: 'Category', value: 'name' }, { text: 'Tracks', value: 'count' }]
      : [{ text: 'Attribute', value: 'name' }, { text: 'Value', value: 'value' },
        { text: 'Scope', value: 'scope' }, { text: 'Occurrences', value: 'count' }]));
    return {
      review,
      statistics,
      incomplete,
      peak,
      timelineStepPath,
      endLabel,
      search,
      table,
      headers,
      dateLabel: (row: TimelineRow) => (row.timestamp === undefined
        ? 'Capture time unavailable' : new Date(row.timestamp * 1000).toLocaleString()),
    };
  },
});
</script>

<template>
  <div class="review-statistics">
    <v-progress-linear v-if="review.loading.value" indeterminate aria-label="Loading statistics" />
    <v-alert v-if="incomplete" dense text type="info">
      Statistics include loaded sequences only. {{ incomplete }} selected sequences are loading,
      queued, or failed. See Datasets for details and retry failed loads there.
    </v-alert>
    <p v-if="!review.datasets.value.length">
      Select sequences on the Datasets page to see their statistics.
    </p>
    <template v-else>
      <h3>{{ statistics.trackCount }} camera tracks across {{ statistics.timelines.length }} sequences</h3>
      <p class="text-caption">
        Uses each sequence's saved category thresholds, independently of the Results filters.
        A track counts once for each qualifying category. Attributes count occurrences on qualifying
        tracks or detections; false and zero are included. Stereo cameras are counted separately.
      </p>
      <div class="d-flex align-center flex-wrap">
        <v-btn-toggle v-model="table" mandatory dense>
          <v-btn small value="categories">
            Categories
          </v-btn>
          <v-btn small value="attributes">
            Attributes
          </v-btn>
        </v-btn-toggle>
        <v-text-field v-model="search" label="Filter counts" clearable dense hide-details class="ml-4" />
      </div>
      <v-data-table
        class="statistics-counts"
        :headers="headers"
        :items="table === 'categories' ? statistics.categories : statistics.attributes"
        :search="search || ''"
        item-key="key"
        :items-per-page="10"
        :footer-props="{ 'items-per-page-options': [10, 25, 50] }"
        sort-by="count"
        :sort-desc="true"
        dense
        no-data-text="No annotations meet the saved thresholds."
      />
      <h3 class="mt-4">
        Sequence timelines
      </h3>
      <p class="text-caption">
        Newest capture time first; undated sequences follow by name. Each row shows elapsed time
        (or frames if any camera lacks FPS), with a shared vertical scale of 0–{{ peak }} tracks.
        Colored steps show each type. All cameras share one sequence plot; matching track IDs
        are counted once on each timeline.
        Tracks span their first through last frame. Video rows use the annotated extent when the
        full media length is unavailable. Scroll within the timelines to see more sequences.
      </p>
      <v-virtual-scroll :items="statistics.timelines" :item-height="180" height="460" class="timeline-list">
        <template #default="{ item }">
          <div class="timeline-row">
            <div class="d-flex align-center">
              <v-btn text small class="timeline-name" :title="item.name" @click="$emit('open-dataset', review.parentOf(item.id))">
                {{ item.name }}
              </v-btn>
              <span class="text-caption ml-2">{{ item.count }} tracks · {{ item.cameraCount }} camera{{ item.cameraCount === 1 ? '' : 's' }} · {{ dateLabel(item) }}</span>
            </div>
            <div class="timeline-legend text-caption">
              <span v-for="series in item.series" :key="series.name" :style="{ color: review.colorFor(series.name) }">
                {{ series.name }}
              </span>
            </div>
            <svg viewBox="0 0 1000 84" preserveAspectRatio="none" role="img" :aria-label="`${item.name}: timelines by type across all cameras`">
              <title>{{ item.name }}: {{ item.count }} tracks across {{ item.cameraCount }} cameras; peak scale {{ peak }}</title>
              <line x1="0" y1="80" x2="1000" y2="80" stroke="currentColor" />
              <path
                v-for="series in item.series"
                :key="series.name"
                :d="timelineStepPath(series.bins, peak)"
                :fill="review.colorFor(series.name)"
                :stroke="review.colorFor(series.name)"
                fill-opacity="0.12"
                stroke-width="1.5"
                vector-effect="non-scaling-stroke"
              >
                <title>{{ series.name }}: peak {{ Math.max(...series.bins) }} tracks</title>
              </path>
            </svg>
            <div class="d-flex justify-space-between text-caption">
              <span>0</span>
              <span v-if="item.annotatedExtent">Annotated extent</span>
              <span>{{ endLabel(item) }}</span>
            </div>
          </div>
        </template>
      </v-virtual-scroll>
    </template>
  </div>
</template>

<style scoped>
.review-statistics { height: 100%; min-height: 0; overflow: auto; padding: 8px; }
.statistics-counts ::v-deep table { color: inherit; }
.timeline-list { border: 1px solid #777; }
.timeline-row { height: 180px; padding: 8px 16px; border-bottom: 1px solid #777; }
.timeline-row svg { display: block; width: 100%; height: 84px; }
.timeline-legend { display: flex; gap: 12px; height: 24px; overflow-x: auto; white-space: nowrap; }
.timeline-name { max-width: 45%; overflow: hidden; text-overflow: ellipsis; }
</style>
