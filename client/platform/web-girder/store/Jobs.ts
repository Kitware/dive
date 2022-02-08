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
    datasetRunningState: (state) => (datasetId: string) => (
      datasetId in state.datasetStatus && !NonRunningStates.includes(state.datasetStatus[datasetId])
    ),
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
    setDatasetStatus(state, { datasetId, value }: { datasetId: string; value: number }) {
      Vue.set(state.datasetStatus, datasetId, value);
    },
    setCompleteJobsInfo(state, { datasetId, type, title }:
      { datasetId: string; type: string; title: string }) {
      Vue.set(state.completeJobsInfo, datasetId, { type, title });
    },

  },
};

export async function init(store: Store<RootState>) {
  const { data: runningJobs } = await girderRest.get<GirderJob[]>('/job', {
    params: { statuses: `[${JobStatus.RUNNING.value}]` },
  });

  function updateJob(job: GirderJob & {type?: string; title?: string}) {
    store.commit('Jobs/setJobState', { jobId: job._id, value: job.status });
    if (typeof job.dataset_id === 'string') {
      store.commit('Jobs/setDatasetStatus', { datasetId: job.dataset_id, value: job.status });
      if (job.status === 3 && job.type === 'pipeline') {
        store.commit('Jobs/setCompleteJobsInfo', { datasetId: job.dataset_id, type: job.type, title: job.title });
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
