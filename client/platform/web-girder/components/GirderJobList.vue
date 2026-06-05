<script setup lang="ts">
import {
  computed, inject, onBeforeUnmount, onMounted, reactive, ref, watch,
} from 'vue';
// qs is provided transitively via @girder/components
// eslint-disable-next-line import/no-extraneous-dependencies
import { stringify } from 'qs';

import type { RestClient } from '@girder/components';
import { formatJob, type GirderJob } from '../girder-jobs/jobFormatter';
import { getByValue } from '../girder-jobs/status';
import JobProgress from './JobProgress.vue';

type RestClientWithCompat = RestClient & {
  $on: RestClient['on'];
  $off: RestClient['off'];
};

const girderRest = inject<RestClientWithCompat>('girderRest');
const notificationBus = inject<RestClientWithCompat>('notificationBus');

const jobFilter = reactive({
  fromDate: null as string | null,
  toDate: null as string | null,
  status: null as number | null,
  jobType: null as string | null,
});

const options = reactive({
  itemsPerPage: 10,
  page: 1,
  sortBy: ['updated'],
  descending: true,
});

const jobs = ref<GirderJob[]>([]);
const typeAndStatusList = ref({ statuses: [] as number[], types: [] as string[] });
const morePages = ref(true);
const refresh = ref(0);

const headers = [
  { title: 'Job Title', key: 'title' },
  { title: 'Type', key: 'type' },
  { title: 'Last Updated', key: 'updated' },
  { title: 'Status', key: 'status' },
  {
    title: '', key: 'actions', sortable: false, align: 'end' as const,
  },
];

const items = computed(() => jobs.value.map(formatJob));

const statusItemList = computed(() => typeAndStatusList.value.statuses
  .map(getByValue)
  .filter((s) => s && s.text)
  .sort((a, b) => a!.text.localeCompare(b!.text)));

async function fetchJobs() {
  if (!girderRest?.user) {
    jobs.value = [];
    return;
  }
  // Read refresh so fetchJobs re-runs when refreshJobList increments the counter.
  const refreshGeneration = refresh.value;
  if (refreshGeneration < 0) {
    return;
  }
  const params: Record<string, unknown> = {
    limit: options.itemsPerPage + 1,
    offset: options.itemsPerPage * (options.page - 1),
  };
  if (options.sortBy.length) {
    const [sortField] = options.sortBy;
    params.sort = sortField;
    params.sortdir = options.descending ? -1 : 1;
  }
  if (jobFilter.status !== null) {
    params.statuses = JSON.stringify([jobFilter.status]);
  }
  if (jobFilter.jobType !== null) {
    params.types = JSON.stringify([jobFilter.jobType]);
  }
  const resp = await girderRest.get<GirderJob[]>(`job?${stringify(params)}`);
  morePages.value = resp.data.length >= (params.limit as number);
  jobs.value = resp.data.slice(0, options.itemsPerPage);
}

async function fetchTypeAndStatus() {
  if (!girderRest?.user) {
    return;
  }
  const resp = await girderRest.get<{ statuses: number[]; types: string[] }>('job/typeandstatus');
  typeAndStatusList.value = resp.data;
}

function refreshJobList() {
  refresh.value += 1;
}

watch([jobFilter, options, () => girderRest?.user, refresh], () => {
  fetchJobs();
}, { deep: true });

watch(jobFilter, () => {
  options.page = 1;
}, { deep: true });

onMounted(() => {
  fetchTypeAndStatus();
  fetchJobs();
  notificationBus?.$on('message:job_status', refreshJobList);
  notificationBus?.$on('message:job_created', refreshJobList);
});

onBeforeUnmount(() => {
  notificationBus?.$off('message:job_status', refreshJobList);
  notificationBus?.$off('message:job_created', refreshJobList);
});

</script>

<template>
  <div>
    <v-row class="mb-4">
      <v-col cols="12" md="3">
        <v-select
          v-model="jobFilter.status"
          :items="statusItemList"
          item-title="text"
          item-value="value"
          label="Status"
          clearable
          density="compact"
        />
      </v-col>
      <v-col cols="12" md="3">
        <v-select
          v-model="jobFilter.jobType"
          :items="typeAndStatusList.types"
          label="Job Type"
          clearable
          density="compact"
        />
      </v-col>
    </v-row>
    <v-data-table
      :headers="headers"
      :items="items"
      :items-per-page="options.itemsPerPage"
      :page="options.page"
      :sort-by="options.sortBy"
      @update:page="options.page = $event"
      @update:items-per-page="options.itemsPerPage = $event"
      @update:sort-by="options.sortBy = $event"
    >
      <template #item.title="{ item }">
        <div class="one-line">
          {{ item.title }}
        </div>
      </template>
      <template #item.updated="{ item }">
        {{ item.updateString }}
      </template>
      <template #item.status="{ item }">
        <JobProgress :formatted-job="item" />
      </template>
      <template #item.actions="{ item }">
        <slot name="jobwidget" :item="item" />
      </template>
    </v-data-table>
  </div>
</template>

<style scoped>
.one-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
