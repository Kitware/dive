<!-- eslint-disable @typescript-eslint/no-explicit-any -->
<script lang="ts">
import {
  defineComponent, ref, onMounted, watch, Ref, nextTick,
  computed,
} from 'vue';
import {
  getStats, DateRange, GroupBy, StatsResponse,
} from 'platform/web-girder/api/configuration.service';
import * as d3 from 'd3';

type DataRecord = Record<string, number>;

type ColorMapping = Record<string, string>;

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
        jobColorMapping.value = renderPieChart(statsTableData.value.jobs, 'globalJobs');
        if (responseData.value.groupByUser?.datasets) {
          userColorMapping.value = renderPieChart(responseData.value.groupByUser.datasets, 'groupByUserDatasets');
          renderPieChart(responseData.value.groupByUser.jobs, 'groupByUserJobs');
        }
        if (responseData.value.groupByMonth) {
          renderBarChart(responseData.value.groupByMonth.datasets, 'groupByMonthDatasets');
          renderBarChart(responseData.value.groupByMonth.newUsers, 'groupByMonthNewUser');
          renderBarChart(responseData.value.groupByMonth.jobs, 'groupByMonthJobs');
        }
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

    // Fetch initial data on mounted
    onMounted(() => fetchData());

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
