<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { useReview } from 'dive-common/use/useReview';
import {
  timelineFrame, timelinePeak, timelineStepPath, timelineTicks, timelineY, TimelineRow,
} from 'dive-common/review/statistics';

export default defineComponent({
  name: 'ReviewStatisticsPanel',
  setup(props, { emit }) {
    const review = useReview();
    const search = ref('');
    const table = ref('categories');
    const { statistics } = review;
    const incomplete = computed(() => review.datasets.value.filter((dataset) => dataset.status !== 'ready').length);
    function endLabel(row: TimelineRow) {
      return `${row.duration.toFixed(row.unit === 's' ? 1 : 0)} ${row.unit}`;
    }
    /** Marks on a row's count axis, placed as a share of the plot's height. */
    function axisTicks(row: TimelineRow) {
      const peak = timelinePeak(row);
      return timelineTicks(peak).map((count) => ({
        count,
        y: timelineY(count, peak),
        top: `${(timelineY(count, peak) / 84) * 100}%`,
      }));
    }
    /** Open the sequence where its plot was clicked. */
    function openAt(row: TimelineRow, event: MouseEvent) {
      const plot = (event.currentTarget as Element).getBoundingClientRect();
      const fraction = plot.width > 0 ? (event.clientX - plot.left) / plot.width : 0;
      emit('open-dataset', review.parentOf(row.id), timelineFrame(row, fraction));
    }
    const headers = computed(() => (table.value === 'categories'
      ? [{ text: 'Category', value: 'name' }, { text: 'Tracks', value: 'count' }]
      : [{ text: 'Attribute', value: 'name' }, { text: 'Value', value: 'value' },
        { text: 'Scope', value: 'scope' }, { text: 'Occurrences', value: 'count' }]));
    return {
      review,
      statistics,
      incomplete,
      timelinePeak,
      timelineStepPath,
      axisTicks,
      openAt,
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
        (or frames if any camera lacks FPS) against the number of tracks present, on a count
        axis of its own that reaches that sequence's peak. The grey outline is the total;
        colored steps show each type. All cameras share one sequence plot; matching track IDs
        are counted once on each timeline.
        Tracks span their first through last frame. Video rows use the annotated extent when the
        full media length is unavailable. Click a plot to open the sequence at that point.
        Scroll within the timelines to see more sequences.
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
              <span class="timeline-total">Total</span>
              <span v-for="series in item.series" :key="series.name" :style="{ color: review.colorFor(series.name) }">
                {{ series.name }}
              </span>
            </div>
            <div class="timeline-plot">
              <div class="timeline-axis-title text-caption">
                Tracks
              </div>
              <div class="timeline-axis text-caption">
                <span v-for="tick in axisTicks(item)" :key="tick.count" :style="{ top: tick.top }">
                  {{ tick.count }}
                </span>
              </div>
              <svg
                viewBox="0 0 1000 84"
                preserveAspectRatio="none"
                role="img"
                :aria-label="`${item.name}: timelines by type across all cameras`"
                @click="openAt(item, $event)"
              >
                <title>{{ item.name }}: {{ item.count }} tracks across {{ item.cameraCount }} cameras; peak of {{ timelinePeak(item) }} at once. Click to open at this point.</title>
                <line
                  v-for="tick in axisTicks(item)"
                  :key="tick.count"
                  x1="0"
                  x2="1000"
                  :y1="tick.y"
                  :y2="tick.y"
                  stroke="currentColor"
                  :stroke-opacity="tick.count ? 0.25 : 1"
                  vector-effect="non-scaling-stroke"
                />
                <line x1="0" y1="0" x2="0" y2="80" stroke="currentColor" vector-effect="non-scaling-stroke" />
                <path
                  v-for="series in item.series"
                  :key="series.name"
                  :d="timelineStepPath(series.bins, timelinePeak(item))"
                  :fill="review.colorFor(series.name)"
                  :stroke="review.colorFor(series.name)"
                  fill-opacity="0.12"
                  stroke-width="1.5"
                  vector-effect="non-scaling-stroke"
                >
                  <title>{{ series.name }}: peak {{ Math.max(...series.bins) }} tracks</title>
                </path>
                <path
                  :d="timelineStepPath(item.bins, timelinePeak(item))"
                  fill="none"
                  stroke="currentColor"
                  stroke-opacity="0.6"
                  stroke-width="1"
                  vector-effect="non-scaling-stroke"
                />
              </svg>
            </div>
            <div class="timeline-extent d-flex justify-space-between text-caption">
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
.timeline-plot { display: flex; height: 84px; }
.timeline-plot svg { display: block; flex: 1 1 0; min-width: 0; height: 84px; cursor: pointer; }
.timeline-axis-title { width: 16px; writing-mode: vertical-rl; transform: rotate(180deg); text-align: center; }
.timeline-axis { position: relative; width: 36px; }
.timeline-axis span { position: absolute; right: 6px; transform: translateY(-50%); line-height: 1; }
/* Starts under the plot, past the count axis */
.timeline-extent { margin-left: 52px; }
.timeline-total { opacity: 0.6; }
.timeline-legend { display: flex; gap: 12px; height: 24px; overflow-x: auto; white-space: nowrap; }
.timeline-name { max-width: 45%; overflow: hidden; text-overflow: ellipsis; }
</style>
