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

export default defineComponent({
  name: 'StatsComponent',
  setup() {
    // State to store data
    const statsTableData: Ref<StatsResponse['table_stats'] | null> = ref();
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

    const renderPieChart = (data: Record<string, number>, target: string) => {
      const pieWidth = 300;
      const pieHeight = 300;
      const radius = Math.min(pieWidth, pieHeight) / 2;

      // Select the target element and append an SVG for the pie chart
      d3.select(`#${target}`).html(''); // This will remove all the children of the target element
      const pieSvg = d3.select(`#${target}`)
        .append('svg')
        .attr('width', pieWidth)
        .attr('height', pieHeight)
        .append('g')
        .attr('transform', `translate(${pieWidth / 2},${pieHeight / 2})`);

      // Define the pie chart layout
      const pie = d3.pie().sort(null).value((d: [string, number]) => d[1]);
      const arc = d3.arc().outerRadius(radius - 10).innerRadius(0);

      // Convert the data object into an array of key-value pairs
      const datasetData = Object.entries(data);

      // Generate the pie chart data using the pie layout
      const pieData = pie(datasetData);

      // Color scale based on the index of the data
      const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

      const colorMapping: Record<string, string> = {};
      // Create the arcs for the pie chart slices
      pieSvg.selectAll('.arc')
        .data(pieData)
        .enter()
        .append('g')
        .attr('class', 'arc')
        .append('path')
        .attr('d', arc)
        .style('fill', (d, i) => {
          const color = colorScale(i);
          colorMapping[d.data[0]] = color; // Map the value to the color
          return color;
        });

      return colorMapping;
    };

    const renderBarChart = (data: Record<string, number>, target: string) => {
      const margin = {
        top: 20, right: 20, bottom: 70, left: 40,
      };
      const width = 800 - margin.left - margin.right;
      const height = 400 - margin.top - margin.bottom;

      // Remove any existing content from the target element
      d3.select(`#${target}`).html('');

      // Create the SVG element for the bar chart
      const svg = d3.select(`#${target}`).append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      // Prepare the data - parse the 'YYYY-MM' keys to use as the X-axis labels
      const dataset = Object.entries(data).map(([key, value]) => ({
        date: key,
        value,
      }));

      // Set up the X and Y scales
      const x = d3.scaleBand()
        .domain(dataset.map((d) => d.date))
        .range([0, width])
        .padding(0.1); // Adds space between bars

      const y = d3.scaleLinear()
        .domain([0, d3.max(dataset, (d) => d.value)!])
        .nice() // Adds some space to the top of the bars
        .range([height, 0]);

      // Add X-axis to the chart
      svg.append('g');
      svg.append('g')
        .attr('class', 'x-axis')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(x))
        .selectAll('text')
        .attr('transform', 'rotate(-90)')
        .attr('text-anchor', 'end')
        .attr('fill', '#ffffff') // Color for the labels
        .attr('dx', -10) // Slight adjustment for alignment
        .attr('dy', -6) // Adjust vertical positioning
        .style('font-size', '12px'); // Make text smaller if needed

      // Add Y-axis to the chart
      svg.append('g')
        .call(d3.axisLeft(y));

      // Create the bars for the bar chart
      svg.selectAll('.bar')
        .data(dataset)
        .enter().append('rect')
        .attr('class', 'bar')
        .attr('x', (d) => x(d.date))
        .attr('y', (d) => y(d.value))
        .attr('width', x.bandwidth())
        .attr('height', (d) => height - y(d.value))
        .attr('fill', '#3498db'); // Customize color for bars
      // Add labels above the bars
      svg.selectAll('.label')
        .data(dataset)
        .enter().append('text')
        .attr('class', 'label')
        .attr('x', (d) => x(d.date) + x.bandwidth() / 2)
        .attr('y', (d) => y(d.value) - 5)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ffffff') // White color for the label
        .attr('font-size', () => Math.max(x.bandwidth() * 0.2, 10)) // Adjust font size based on bar width
        .text((d) => d.value);
    };

    // Fetch initial data on mounted
    onMounted(fetchData);

    // Watch for changes in dropdowns
    watch([selectedDateRange, selectedGroupBy], fetchData);

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
