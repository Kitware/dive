import { Store, Module } from 'vuex';
import { GirderJob } from '@girder/components/src';
import { all } from '@girder/components/src/components/Job/status';
import Vue from 'vue';

import eventBus from 'platform/web-girder/eventBus';
import girderRest from 'platform/web-girder/plugins/girder';
import { RootState, JobState } from './types';


const JobStatus = all();
const NonRunningStates = [
  JobStatus.CANCELED.value,
  JobStatus.ERROR.value,
  JobStatus.SUCCESS.value,
];

const jobModule: Module<JobState, RootState> = {
  namespaced: true,
  state: {
    jobIds: {},
    datasetStatus: {},
    completeJobsInfo: {},
  },
  getters: {
    runningJobIds(state) {
      return Object.values(state.jobIds).filter((v) => !NonRunningStates.includes(v)).length >= 1;
    },
    datasetRunningState: (state) => (datasetId: string) => {
      if (datasetId in state.datasetStatus
        && !NonRunningStates.includes(state.datasetStatus[datasetId].status)) {
        return `/girder/#job/${state.datasetStatus[datasetId].jobId}`;
      }
      return false;
    },
    datasetCompleteJobs: (state) => (datasetId: string) => {
      if (datasetId in state.completeJobsInfo) {
        return (state.completeJobsInfo[datasetId]);
      }
      return false;
    },
  },
  mutations: {
    setJobState(state, { jobId, value }: { jobId: string; value: number }) {
      Vue.set(state.jobIds, jobId, value);
    },
    setDatasetStatus(state, { datasetId, status, jobId }:
      { datasetId: string; status: number; jobId: string }) {
      Vue.set(state.datasetStatus, datasetId, { status, jobId });
    },
    setCompleteJobsInfo(state, {
      datasetId, type, title, success,
    }:
      { datasetId: string; type: string; title: string; success: boolean }) {
      Vue.set(state.completeJobsInfo, datasetId, { type, title, success });
    },
    removeCompleteJobsInfo(state, { datasetId }: { datasetId: string }) {
      if (datasetId in state.completeJobsInfo) {
        Vue.delete(state.completeJobsInfo, datasetId);
      }
    },
  },
  actions: {
    removeCompleteJob({ commit }, { datasetId }: {datasetId: string}) {
      commit('removeCompleteJobsInfo', { datasetId });
    },
  },
};

export async function init(store: Store<RootState>) {
  const { data: runningJobs } = await girderRest.get<GirderJob[]>('/job', {
    params: { statuses: `[${JobStatus.RUNNING.value}, ${JobStatus.QUEUED.value}, ${JobStatus.INACTIVE.value}]` },
  });
  function updateJob(job: GirderJob & {type?: string; title?: string}) {
    store.commit('Jobs/setJobState', { jobId: job._id, value: job.status });
    if (typeof job.dataset_id === 'string') {
      store.commit('Jobs/setDatasetStatus', { datasetId: job.dataset_id, status: job.status, jobId: job._id });
      if (job.type === 'pipelines' && NonRunningStates.includes(job.status)) {
        store.commit('Jobs/setCompleteJobsInfo', {
          datasetId: job.dataset_id,
          type: job.type,
          title: job.title,
          success: job.status === JobStatus.SUCCESS.value,
        });
      }
    }
  }

  runningJobs.forEach(updateJob);
  girderRest.$on('message:job_status', ({ data: job }: { data: GirderJob }) => {
    updateJob(job);
    eventBus.$emit('refresh-data-browser');
  });
}

export default jobModule;
