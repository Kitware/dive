<script lang="ts">
import {
  defineComponent, inject, onBeforeUnmount, onMounted, reactive, ref, watch,
} from 'vue';
import { stringify } from 'qs';

import type { RestClient } from '@girder/components';

import FilterForm from './FilterForm.vue';
import JobTable from './JobTable.vue';

interface NotificationBus {
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
}

export default defineComponent({
  name: 'GirderJobList',
  components: {
    JobTable,
    FilterForm,
  },
  emits: ['job-click'],
  setup() {
    const girderRest = inject<RestClient>('girderRest')!;
    const notificationBus = inject<NotificationBus>('notificationBus')!;

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
    const morePages = ref(true);
    const refresh = ref(0);
    const jobs = ref<Record<string, unknown>[]>([]);
    const typeAndStatusList = ref({ statuses: [] as number[], types: [] as string[] });

    async function loadJobs() {
      // eslint-disable-next-line no-unused-expressions
      girderRest.user;
      // eslint-disable-next-line no-unused-expressions
      refresh.value;
      const params: Record<string, unknown> = {
        limit: options.itemsPerPage + 1,
        offset: options.itemsPerPage * (options.page - 1),
      };
      if (options.sortBy?.length) {
        params.sort = options.sortBy;
        params.sortdir = options.descending ? -1 : 1;
      }
      if (jobFilter.status !== null) {
        params.statuses = JSON.stringify([jobFilter.status]);
      }
      if (jobFilter.jobType !== null) {
        params.types = JSON.stringify([jobFilter.jobType]);
      }
      const resp = await girderRest.get(`job?${stringify(params)}`);
      morePages.value = resp.data.length >= (params.limit as number);
      jobs.value = resp.data.slice(0, options.itemsPerPage);
    }

    async function loadTypeAndStatus() {
      // eslint-disable-next-line no-unused-expressions
      girderRest.user;
      const resp = await girderRest.get('job/typeandstatus');
      typeAndStatusList.value = resp.data;
    }

    function refreshJobList() {
      refresh.value += 1;
    }

    watch([jobFilter, options, refresh], () => {
      loadJobs().catch(() => undefined);
    }, { deep: true });

    watch(() => girderRest.user, () => {
      loadJobs().catch(() => undefined);
      loadTypeAndStatus().catch(() => undefined);
    });

    watch(jobFilter, () => {
      options.page = 1;
    }, { deep: true });

    onMounted(() => {
      loadJobs().catch(() => undefined);
      loadTypeAndStatus().catch(() => undefined);
      notificationBus.on('message:job_status', refreshJobList);
      notificationBus.on('message:job_created', refreshJobList);
    });

    onBeforeUnmount(() => {
      notificationBus.off('message:job_status', refreshJobList);
      notificationBus.off('message:job_created', refreshJobList);
    });

    return {
      jobFilter,
      options,
      morePages,
      jobs,
      typeAndStatusList,
    };
  },
});
</script>

<template>
  <v-card
    class="girder-job-list"
    color="primary"
  >
    <filter-form
      v-model:job-type="jobFilter.jobType"
      v-model:status="jobFilter.status"
      :status-list="typeAndStatusList.statuses"
      :job-type-list="typeAndStatusList.types"
    />
    <job-table
      :jobs="jobs"
      :options="options"
      :more-pages="morePages"
      @update:options="Object.assign(options, $event)"
      @job-click="(e, job) => $emit('job-click', e, job)"
    >
      <template
        v-if="$slots.jobwidget"
        #jobwidget="props"
      >
        <slot
          v-bind="props"
          name="jobwidget"
        />
      </template>
    </job-table>
  </v-card>
</template>
