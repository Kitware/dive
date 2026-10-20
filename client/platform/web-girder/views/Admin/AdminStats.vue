<!-- eslint-disable @typescript-eslint/no-explicit-any -->
<script lang="ts">
import {
  defineComponent, ref, onMounted, watch, Ref, nextTick,
  computed,
} from 'vue';
import {
  getStats, DateRange, GroupBy, StatsResponse,
  startAnnotationStatsJob, getLatestAnnotationStats, AnnotationStatsReport,
} from 'platform/web-girder/api/configuration.service';
import girderRest from 'platform/web-girder/plugins/girder';
import { isJobFinished, jobSucceeded } from 'platform/web-girder/store/useJobs';
import * as d3 from 'd3';

type DataRecord = Record<string, number>;

type ColorMapping = Record<string, string>;

type AnnotationStatsJobDoc = {
  status: number;
  title?: string;
  meta?: { annotationStats?: AnnotationStatsReport };
};

export default defineComponent({
  name: 'StatsComponent',
  setup() {
    // State to store data
    const statsTableData: Ref<StatsResponse['table_stats'] | null> = ref(null);
    const responseData: Ref<StatsResponse | null> = ref(null);
    const selectedDateRange = ref<DateRange>('6 months');
    const selectedGroupBy = ref<GroupBy>();
    const userLimit = ref(20);
    const jobColorMapping: Ref<Record<string, string>> = ref({});
    const userColorMapping: Ref<Record<string, string>> = ref({});

    const dateRangeOptions = ref(['60 days', '3 months', '6 months', '1 year', '3 years', '5 years']);
    const groupByOptions = ref(['', 'user', 'month']);

    const annotationStatsRunning = ref(false);
    const annotationStatsLoading = ref(false);
    const annotationStatsJobId = ref<string | null>(null);
    const annotationStatsError = ref<string | null>(null);
    const annotationStatsReport = ref<AnnotationStatsReport | null>(null);
    const showAnnotationStatsInfo = ref(false);

    const totalJobs = computed(() => {
      if (statsTableData.value) {
        return Object.values(statsTableData.value.jobs).reduce((prev, current) => (prev + current), 0);
      }
      return 0;
    });

    // Fetch data onMounted
    const fetchData = async (initial = false) => {
      const { data } = await getStats(
        selectedDateRange.value,
        undefined,
        selectedGroupBy.value,
        userLimit.value,
      );
      responseData.value = data;
      statsTableData.value = data.table_stats;
      if (!initial) {
        nextTick(() => {
          if (statsTableData.value?.jobs) {
            jobColorMapping.value = renderPieChart(statsTableData.value.jobs, 'globalJobs');
          }
        });
      } else {
        nextTick(() => {
          if (statsTableData.value) {
            jobColorMapping.value = renderPieChart(statsTableData.value.jobs, 'globalJobs');
          }
          if (responseData.value?.groupByUser?.datasets) {
            userColorMapping.value = renderPieChart(responseData.value.groupByUser.datasets, 'groupByUserDatasets');
            renderPieChart(responseData.value.groupByUser.jobs, 'groupByUserJobs');
          }
          if (responseData.value?.groupByMonth) {
            renderBarChart(responseData.value.groupByMonth.datasets, 'groupByMonthDatasets');
            renderBarChart(responseData.value.groupByMonth.newUsers, 'groupByMonthNewUser');
            renderBarChart(responseData.value.groupByMonth.jobs, 'groupByMonthJobs');
          }
        });
      }
    };

    const renderPieChart = (data: DataRecord, target: string): ColorMapping => {
      const pieWidth = 300;
      const pieHeight = 300;
      const radius = Math.min(pieWidth, pieHeight) / 2;

      d3.select(`#${target}`).html('');
      const pieSvg = d3.select(`#${target}`)
        .append('svg')
        .attr('width', pieWidth)
        .attr('height', pieHeight)
        .append('g')
        .attr('transform', `translate(${pieWidth / 2},${pieHeight / 2})`);

      const pie = d3.pie<[string, number]>().sort(null).value((d) => d[1]);
      const arc = d3.arc<d3.PieArcDatum<[string, number]>>().outerRadius(radius - 10).innerRadius(0);
      const datasetData = Object.entries(data);
      const pieData = pie(datasetData);

      const colorScale = d3.scaleOrdinal<string>().domain(datasetData.map((d) => d[0])).range(d3.schemeCategory10);
      const colorMapping: ColorMapping = {};

      pieSvg.selectAll('.arc')
        .data(pieData)
        .enter()
        .append('g')
        .attr('class', 'arc')
        .append('path')
        .attr('d', arc as any)
        .style('fill', (d) => {
          const color = colorScale(d.data[0]);
          colorMapping[d.data[0]] = color;
          return color;
        });

      return colorMapping;
    };

    const renderBarChart = (data: DataRecord, target: string) => {
      const margin = {
        top: 20, right: 20, bottom: 70, left: 40,
      };
      const width = 800 - margin.left - margin.right;
      const height = 400 - margin.top - margin.bottom;

      d3.select(`#${target}`).html('');
      const svg = d3.select(`#${target}`).append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      const dataset = Object.entries(data).map(([key, value]) => ({ date: key, value }));
      const x = d3.scaleBand().domain(dataset.map((d) => d.date)).range([0, width]).padding(0.1);
      const y = d3.scaleLinear().domain([0, d3.max(dataset, (d) => d.value) || 0]).nice().range([height, 0]);

      svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(x))
        .selectAll('text')
        .attr('transform', 'rotate(-90)')
        .attr('text-anchor', 'end')
        .attr('x', -15)
        .attr('y', -5)
        .style('fill', '#ffffff');

      svg.append('g').call(d3.axisLeft(y));

      svg.selectAll('.bar')
        .data(dataset)
        .enter().append('rect')
        .attr('class', 'bar')
        .attr('x', (d) => x(d.date) || 0)
        .attr('y', (d) => y(d.value) ?? 0)
        .attr('width', x.bandwidth())
        .attr('height', (d) => height - (y(d.value) ?? 0))
        .attr('fill', '#3498db');
    };

    const sleep = (ms: number) => new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

    const loadSavedAnnotationStats = async () => {
      annotationStatsLoading.value = true;
      try {
        const { data } = await getLatestAnnotationStats();
        if (data && typeof data === 'object' && data.datasets && data.tracks) {
          annotationStatsReport.value = data;
        }
      } catch {
        // No saved report yet (or folder missing) is fine on first visit.
      } finally {
        annotationStatsLoading.value = false;
      }
    };

    const runAnnotationStats = async () => {
      annotationStatsRunning.value = true;
      annotationStatsError.value = null;
      annotationStatsJobId.value = null;
      try {
        const { data } = await startAnnotationStatsJob();
        annotationStatsJobId.value = data.jobId;
        const deadline = Date.now() + 60 * 60 * 1000;
        /* eslint-disable no-await-in-loop -- poll until the inventory job finishes */
        while (Date.now() < deadline) {
          const { data: job } = await girderRest.get<AnnotationStatsJobDoc>(`job/${data.jobId}`);
          if (isJobFinished(job.status)) {
            if (!jobSucceeded(job.status)) {
              throw new Error(job.title || 'Annotation stats job failed');
            }
            // Prefer the persisted Stats-folder copy so refresh matches this view.
            const { data: saved } = await getLatestAnnotationStats();
            const report = saved || job.meta?.annotationStats;
            if (!report) {
              throw new Error('Annotation stats job finished without a report payload');
            }
            annotationStatsReport.value = report;
            return;
          }
          await sleep(2000);
        }
        /* eslint-enable no-await-in-loop */
        throw new Error('Timed out waiting for annotation stats job');
      } catch (err) {
        annotationStatsError.value = err instanceof Error ? err.message : String(err);
      } finally {
        annotationStatsRunning.value = false;
      }
    };

    const downloadAnnotationStats = () => {
      if (!annotationStatsReport.value) return;
      const blob = new Blob(
        [JSON.stringify(annotationStatsReport.value, null, 2)],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `annotation-stats-${annotationStatsReport.value.generatedAt}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    };

    // Fetch initial data on mounted
    onMounted(() => {
      fetchData();
      loadSavedAnnotationStats();
    });

    // Watch for changes in dropdowns
    watch([selectedDateRange, selectedGroupBy], () => fetchData());

    return {
      statsTableData,
      totalJobs,
      selectedDateRange,
      selectedGroupBy,
      dateRangeOptions,
      groupByOptions,
      fetchData,
      jobColorMapping,
      userColorMapping,
      responseData,
      userLimit,
      annotationStatsRunning,
      annotationStatsLoading,
      annotationStatsJobId,
      annotationStatsError,
      annotationStatsReport,
      runAnnotationStats,
      downloadAnnotationStats,
      showAnnotationStatsInfo,
    };
  },
});
</script>

<template>
  <v-container>
    <!-- Dropdowns for Date Range and GroupBy -->
    <v-row>
      <v-col cols="2" sm="4">
        <v-select
          v-model="selectedDateRange"
          :items="dateRangeOptions"
          label="Select Date Range"
          @change="fetchData"
        />
      </v-col>
      <v-col cols="2" sm="4">
        <v-select
          v-model="selectedGroupBy"
          :items="groupByOptions"
          label="Group By"
          @change="fetchData"
        />
      </v-col>
      <v-col v-if="selectedGroupBy === 'user'" cols="2" sm="2">
        <v-slider
          v-model="userLimit"
          :min="5"
          :max="100"
          label="User Limit"
          thumb-label="always"
          hide-details
          class="mt-6"
          @change="fetchData"
        />
      </v-col>
    </v-row>

    <!-- Stats Table -->
    <v-row v-if="statsTableData" class="mt-2">
      <v-col cols="auto">
        <div>
          <v-chip class="my-2" color="primary">
            Datasets: <span class="ml-2 "> {{ statsTableData?.datasets }}</span>
          </v-chip>
        </div>
        <div>
          <v-chip class="my-2" color="info">
            Total Users: <span class="ml-2"> {{ statsTableData?.totalUsers }}</span>
          </v-chip>
        </div>
        <div>
          <v-chip class="my-2" color="warning">
            New Users: <span class="ml-2"> {{ statsTableData?.newUsers }}</span>
          </v-chip>
        </div>
        <div>
          <v-chip class="my-2" color="success">
            Total Jobs: <span class="ml-2"> {{ totalJobs }}</span>
          </v-chip>
        </div>
      </v-col>
      <v-col cols="auto">
        <v-row v-for="(color, key) in jobColorMapping" :key="key" dense align="center" justify="end">
          <span>{{ key }}</span>
          <span class="mx-1">({{ statsTableData.jobs[key] }}):</span>

          <div
            class="type-color-box"
            :style="{
              backgroundColor: color,
            }"
          />
        </v-row>
      </v-col>
      <v-col cols="2">
        <div id="globalJobs" /> <!-- Div container for the pie chart -->
      </v-col>
    </v-row>

    <v-row v-if="selectedGroupBy === 'user' && responseData?.groupByUser">
      <v-col cols="auto">
        <v-card>
          <v-card-title>Datasets</v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="auto">
                <v-row v-for="(color, key) in userColorMapping" :key="`userDataset_${key}`" dense align="center" justify="end">
                  <span>{{ key }}</span>
                  <span class="mx-1">({{ responseData.groupByUser.datasets[key] }}):</span>

                  <div
                    class="type-color-box"
                    :style="{
                      backgroundColor: color,
                    }"
                  />
                </v-row>
              </v-col>
              <v-col cols="2">
                <div id="groupByUserDatasets" />
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="auto">
        <v-card>
          <v-card-title>Jobs</v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="auto">
                <v-row v-for="(color, key) in userColorMapping" :key="`userJob_${key}`" dense align="center" justify="end">
                  <span>{{ key }}</span>
                  <span class="mx-1">({{ responseData.groupByUser.jobs[key] }}):</span>

                  <div
                    class="type-color-box"
                    :style="{
                      backgroundColor: color,
                    }"
                  />
                </v-row>
              </v-col>
              <v-col cols="2">
                <div id="groupByUserJobs" />
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-row v-if="selectedGroupBy === 'month' && responseData?.groupByMonth">
      <v-col cols="auto">
        <v-card>
          <v-card-title>Datasets</v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="auto">
                <div id="groupByMonthDatasets" />
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="auto">
        <v-card>
          <v-card-title>New Users</v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="auto">
                <div id="groupByMonthNewUser" />
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="auto">
        <v-card>
          <v-card-title>Jobs</v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="auto">
                <div id="groupByMonthJobs" />
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-row class="mt-6">
      <v-col cols="12">
        <v-card>
          <v-card-title>
            Annotation inventory
            <v-spacer />
            <v-tooltip bottom>
              <template #activator="{ on, attrs }">
                <v-btn
                  icon
                  small
                  color="primary"
                  aria-label="How annotation stats are calculated"
                  v-bind="attrs"
                  @click="showAnnotationStatsInfo = true"
                  v-on="on"
                >
                  <v-icon>mdi-information-outline</v-icon>
                </v-btn>
              </template>
              <span>How these stats are calculated</span>
            </v-tooltip>
          </v-card-title>
          <v-card-text>
            <p class="mb-3">
              Run a background job that counts datasets, tracks, detections,
              videos, image sequences and individual images, confidence &ge; 1,
              curation classes (mostly manual / substantially corrected / mostly computed),
              and label totals. Results are saved under your user
              <code>Stats</code> folder so they remain after refresh.
            </p>
            <v-btn
              color="primary"
              :loading="annotationStatsRunning"
              :disabled="annotationStatsRunning"
              @click="runAnnotationStats"
            >
              Generate annotation report
            </v-btn>
            <v-btn
              text
              color="primary"
              class="ml-2"
              @click="showAnnotationStatsInfo = true"
            >
              <v-icon left>
                mdi-information-outline
              </v-icon>
              How are these calculated?
            </v-btn>
            <a
              v-if="annotationStatsJobId"
              class="ml-4"
              :href="`/girder/#job/${annotationStatsJobId}`"
              target="_blank"
              rel="noopener noreferrer"
            >
              View job
            </a>
            <v-alert
              v-if="annotationStatsError"
              type="error"
              dense
              text
              class="mt-4"
            >
              {{ annotationStatsError }}
            </v-alert>
            <div
              v-if="annotationStatsLoading"
              class="mt-4 text-caption"
            >
              Loading saved report...
            </div>
            <div
              v-else-if="!annotationStatsReport && !annotationStatsRunning"
              class="mt-4 text-caption"
            >
              No saved report yet. Generate one to keep results available after refresh.
            </div>
            <template v-if="annotationStatsReport">
              <div class="mt-4 mb-2 text-caption">
                Saved report from {{ annotationStatsReport.generatedAt }}
              </div>
              <v-chip class="ma-1" color="primary">
                Datasets: {{ annotationStatsReport.datasets.total }}
              </v-chip>
              <template v-if="annotationStatsReport.media">
                <v-chip class="ma-1" color="deep-purple">
                  Videos: {{ annotationStatsReport.media.videos }}
                </v-chip>
                <v-chip class="ma-1" color="teal">
                  Image sequences: {{ annotationStatsReport.media.imageSequences }}
                </v-chip>
                <v-chip class="ma-1" color="cyan">
                  Images: {{ annotationStatsReport.media.images }}
                </v-chip>
              </template>
              <v-chip class="ma-1" color="info">
                Tracks: {{ annotationStatsReport.tracks.total }}
              </v-chip>
              <v-chip
                v-if="annotationStatsReport.tracks.detections !== undefined"
                class="ma-1"
                color="indigo"
              >
                Detections: {{ annotationStatsReport.tracks.detections }}
              </v-chip>
              <v-chip class="ma-1" color="success">
                Confidence &ge; 1: {{ annotationStatsReport.tracks.confidenceGte1 }}
              </v-chip>
              <v-chip class="ma-1">
                Mostly manual: {{ annotationStatsReport.datasets.mostlyManual }}
              </v-chip>
              <v-chip class="ma-1">
                Mixed / corrected: {{ annotationStatsReport.datasets.mixedSubstantialCorrections }}
              </v-chip>
              <v-chip class="ma-1">
                Mostly computed: {{ annotationStatsReport.datasets.mostlyComputed }}
              </v-chip>
              <v-chip class="ma-1">
                Empty: {{ annotationStatsReport.datasets.empty }}
              </v-chip>
              <div class="mt-4">
                <v-btn
                  small
                  outlined
                  color="primary"
                  @click="downloadAnnotationStats"
                >
                  Download JSON
                </v-btn>
              </div>
            </template>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-dialog
      v-model="showAnnotationStatsInfo"
      max-width="860"
      scrollable
    >
      <v-card>
        <v-card-title class="annotation-stats-info-title">
          <v-icon
            left
            color="primary"
          >
            mdi-information-outline
          </v-icon>
          How annotation stats are calculated
          <v-spacer />
          <v-btn
            icon
            aria-label="Close"
            @click="showAnnotationStatsInfo = false"
          >
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4 annotation-stats-info">
          <v-alert
            type="info"
            text
            dense
            class="mb-4"
          >
            This is a point-in-time inventory of every dataset folder, counting only
            <strong>live tracks</strong> (deleted revisions are excluded). Generating a
            report re-runs the counts and saves the result to your <code>Stats</code>
            folder; the numbers shown are from the report&rsquo;s
            <em>generatedAt</em> timestamp, not a live query.
          </v-alert>

          <h3>Manual vs. corrected &mdash; the key difference</h3>
          <p>
            These two signals describe different things and are counted from different
            fields, so a track is never counted as both:
          </p>
          <v-row dense>
            <v-col
              cols="12"
              sm="6"
            >
              <v-card
                outlined
                class="pa-3 fill-height"
              >
                <div class="font-weight-bold mb-1">
                  <v-icon
                    small
                    left
                    color="primary"
                  >
                    mdi-pencil-plus-outline
                  </v-icon>
                  Manual &mdash; created by a person
                </div>
                <p class="mb-2">
                  The track was <strong>originally drawn / created by a user</strong> in
                  the annotator. It is identified directly from provenance:
                  <code>attributes.userCreated === true</code>.
                </p>
                <p class="mb-0 text-caption">
                  A manual track stays &ldquo;manual&rdquo; no matter how much it is
                  edited afterwards, and regardless of its confidence value.
                </p>
              </v-card>
            </v-col>
            <v-col
              cols="12"
              sm="6"
            >
              <v-card
                outlined
                class="pa-3 fill-height"
              >
                <div class="font-weight-bold mb-1">
                  <v-icon
                    small
                    left
                    color="success"
                  >
                    mdi-robot-outline
                  </v-icon>
                  Corrected &mdash; computed, then endorsed
                </div>
                <p class="mb-2">
                  The track was <strong>created by a pipeline / import</strong>
                  (<code>userCreated</code> is not <code>true</code>), but its first
                  confidence pair is now <strong>&ge; 1</strong> &mdash; the state left
                  behind when a reviewer accepts the track or sets its type, which
                  stores a single pair at confidence <code>1</code>.
                </p>
                <p class="mb-0 text-caption">
                  Unlike &ldquo;manual&rdquo;, this is an <em>inferred proxy</em> for
                  human correction, not a recorded edit history (see limitations below).
                </p>
              </v-card>
            </v-col>
          </v-row>
          <p class="mt-3">
            In short: <strong>manual = a human made the track</strong>;
            <strong>corrected = a machine made the track and a human (probably)
              signed off on it</strong>. A dataset can contain a mixture of both.
          </p>

          <h3>Per-track signals</h3>
          <p>
            For each dataset the job tallies its live tracks into the counters below.
            The classification that follows is built entirely from these four numbers.
          </p>
          <v-simple-table dense>
            <template #default>
              <thead>
                <tr>
                  <th>Counter</th>
                  <th>How it is counted</th>
                  <th>What it means</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="font-weight-medium">
                    Total (<code>T</code>)
                  </td>
                  <td>All live tracks in the dataset</td>
                  <td>Denominator for every fraction below</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">
                    Detections
                  </td>
                  <td>
                    Sum of <code>$size(features)</code> over all live tracks, folded
                    into the same aggregation pass as the other track counters
                  </td>
                  <td>
                    Each stored <code>Feature</code> is a single detection (one
                    frame&rsquo;s bounds / geometry on a track)
                  </td>
                </tr>
                <tr>
                  <td class="font-weight-medium">
                    Manual (<code>M</code>)
                  </td>
                  <td><code>attributes.userCreated === true</code></td>
                  <td>Tracks created by a user</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">
                    Computed (<code>C</code>)
                  </td>
                  <td><code>C = T &minus; M</code> (derived, not stored)</td>
                  <td>Tracks produced by pipelines or imports</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">
                    Corrected (<code>R</code>)
                  </td>
                  <td>
                    Computed tracks whose <em>first</em> confidence pair is &ge; 1
                  </td>
                  <td>Proxy for reviewed / accepted computed tracks</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">
                    Confidence &ge; 1
                  </td>
                  <td>
                    <em>All</em> tracks (manual and computed) whose first confidence
                    pair is &ge; 1
                  </td>
                  <td>
                    The headline chip total. It overlaps both groups above, so it is
                    <em>not</em> the same as the corrected count <code>R</code>
                  </td>
                </tr>
              </tbody>
            </template>
          </v-simple-table>

          <h3>Dataset classification</h3>
          <p>
            Each dataset with at least one live track is placed in exactly one
            category. Rules are evaluated <strong>in this order</strong> &mdash;
            &ldquo;mostly manual&rdquo; wins if a dataset somehow matches both rules:
          </p>
          <v-simple-table dense>
            <template #default>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Rule</th>
                  <th>Interpretation</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="font-weight-medium">
                    Mostly manual
                  </td>
                  <td>
                    <code>T &ge; 5</code> and <code>M / T &ge; 90%</code>
                  </td>
                  <td>Primarily hand-annotated</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">
                    Mixed / corrected
                  </td>
                  <td>
                    <code>C &ge; 10</code> and <code>R &ge; 15</code> and
                    <code>R / C &ge; 25%</code>
                  </td>
                  <td>
                    Mostly computed, but a substantial share was reviewed / corrected
                  </td>
                </tr>
                <tr>
                  <td class="font-weight-medium">
                    Mostly computed
                  </td>
                  <td>Any other dataset with &ge; 1 live track</td>
                  <td>
                    Computed output with little or no detected correction &mdash;
                    the fallback category
                  </td>
                </tr>
                <tr>
                  <td class="font-weight-medium">
                    Empty
                  </td>
                  <td><code>T = 0</code></td>
                  <td>Dataset folder with no live tracks</td>
                </tr>
              </tbody>
            </template>
          </v-simple-table>
          <p class="mt-3 mb-1 font-weight-medium">
            Worked examples
          </p>
          <v-simple-table dense>
            <template #default>
              <thead>
                <tr>
                  <th>Tracks</th>
                  <th>Result</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>20 total, 19 manual</td>
                  <td>Mostly manual</td>
                  <td>19 / 20 = 95% manual, and at least 5 tracks</td>
                </tr>
                <tr>
                  <td>100 total, 5 manual, 30 corrected</td>
                  <td>Mixed / corrected</td>
                  <td>
                    30 / 95 computed = ~32% corrected, above the 25% / 15-track bars
                  </td>
                </tr>
                <tr>
                  <td>100 total, 5 manual, 10 corrected</td>
                  <td>Mostly computed</td>
                  <td>10 / 95 = ~11% corrected &mdash; below both correction bars</td>
                </tr>
                <tr>
                  <td>4 total, all 4 manual</td>
                  <td>Mostly computed</td>
                  <td>
                    Fewer than the 5-track minimum for &ldquo;mostly manual&rdquo;,
                    despite being 100% manual
                  </td>
                </tr>
              </tbody>
            </template>
          </v-simple-table>

          <h3>Totals and labels</h3>
          <ul>
            <li>
              <strong>Datasets</strong> counts every dataset folder, including empty
              ones; the four category chips always sum to this total.
            </li>
            <li>
              <strong>Videos</strong> counts one logical video per video dataset
              (and per camera of a multicam dataset), from the folder&rsquo;s
              <code>meta.type</code> &mdash; <em>not</em> per file. A folder holding
              both an original video and its transcoded
              <code>*.transcoded.mp4</code> derivative therefore counts once, as
              does a web-safe original whose transcoding was skipped.
            </li>
            <li>
              <strong>Image sequences</strong> counts one per image-sequence dataset
              (and per camera of a multicam dataset), also from
              <code>meta.type</code>. The multicam parent folder itself counts as
              neither a video nor an image sequence.
            </li>
            <li>
              <strong>Images</strong> counts the individual image files in
              image-sequence and large-image datasets, in a single grouped pass
              over those folders&rsquo; items (all valid image / large-image
              extensions, so an original counts once and its converted
              replacement &mdash; which deletes the original &mdash; also counts
              once). A cloned dataset&rsquo;s images are resolved through its
              source folder and count toward the clone, just as its copied
              tracks do. Large-image files count as images but their datasets
              are not image sequences.
            </li>
            <li>
              <strong>Tracks</strong> counts live tracks across all datasets.
            </li>
            <li>
              <strong>Detections</strong> is the total number of stored features
              across those live tracks &mdash; one feature is one detection on
              one frame.
            </li>
            <li>
              <strong>Labels</strong> (in the downloaded JSON) group live tracks by
              the type name of their highest-scoring confidence pair.
            </li>
          </ul>

          <h3>Limitations &mdash; read the corrected numbers with care</h3>
          <ul>
            <li>
              <strong>Corrected is inferred, not audited.</strong> The job deliberately
              does not scan per-detection edit history (<code>userModified</code>),
              which keeps it fast on very large collections but means the proxy can be
              wrong in both directions.
            </li>
            <li>
              <strong>Possible false positives:</strong> a pipeline or import that
              already emits confidence <code>1.0</code> counts as
              &ldquo;corrected&rdquo; even if nobody ever reviewed it.
            </li>
            <li>
              <strong>Possible false negatives:</strong> geometry-only edits,
              deletions, attribute edits, type changes left below confidence
              <code>1</code>, and corrections that are not the first confidence pair
              are invisible to this count.
            </li>
            <li>
              <strong>Thresholds are heuristics.</strong> A dataset just under a cutoff
              (e.g. 14 corrected tracks, or 24% corrected) lands in
              &ldquo;mostly computed&rdquo;, so small datasets in particular can sit in
              a category that understates the human effort involved.
            </li>
          </ul>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn
            color="primary"
            text
            @click="showAnnotationStatsInfo = false"
          >
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
/* Custom Styles */
.annotation-stats-info h3 {
  font-size: 1rem;
  font-weight: 600;
  margin: 20px 0 8px;
}

.annotation-stats-info h3:first-of-type {
  margin-top: 4px;
}

.annotation-stats-info p,
.annotation-stats-info li {
  line-height: 1.5;
}

.annotation-stats-info ul {
  margin-bottom: 4px;
}

.annotation-stats-info li {
  margin-bottom: 4px;
}

.annotation-stats-info-title {
  word-break: normal;
}

.type-color-box {
  min-width: 10px;
  max-width: 10px;
  min-height: 10px;
  max-height: 10px;
}

</style>
