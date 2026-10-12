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
          <v-card-title>Annotation inventory</v-card-title>
          <v-card-text>
            <p class="mb-3">
              Run a background job that counts datasets, tracks, confidence &ge; 1,
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
              <v-chip class="ma-1" color="info">
                Tracks: {{ annotationStatsReport.tracks.total }}
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
  </v-container>
</template>

<style scoped>
/* Custom Styles */
.type-color-box {
  min-width: 10px;
  max-width: 10px;
  min-height: 10px;
  max-height: 10px;
}

</style>
