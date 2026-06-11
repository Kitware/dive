/* eslint-disable import/prefer-default-export -- singleton composable store */
import { computed, ref } from 'vue';
import { all } from 'platform/web-girder/components/job/status';

import eventBus from 'platform/web-girder/eventBus';
import { getNotificationBus } from 'platform/web-girder/plugins/girder';
import girderRest from 'platform/web-girder/plugins/girder';
import type { GirderJob } from './types';

const JobStatus = all();
const NonRunningStates = [
  JobStatus.CANCELED.value,
  JobStatus.ERROR.value,
  JobStatus.SUCCESS.value,
];

const jobIds = ref<Record<string, number>>({});
const datasetStatus = ref<Record<string, { status: number; jobId: string }>>({});
const completeJobsInfo = ref<Record<string, { type: string; title: string; success: boolean }>>({});

const runningJobIds = computed(
  () => Object.values(jobIds.value).filter((v) => !NonRunningStates.includes(v)).length >= 1,
);

export function useJobs() {
  function getJobIds(): Record<string, number> {
    return jobIds.value;
  }

  function setJobState(payload: { jobId: string; value: number }): void {
    jobIds.value[payload.jobId] = payload.value;
  }

  function getDatasetStatus(): Record<string, { status: number; jobId: string }> {
    return datasetStatus.value;
  }

  function setDatasetStatus(payload: { datasetId: string; status: number; jobId: string }): void {
    datasetStatus.value[payload.datasetId] = {
      status: payload.status,
      jobId: payload.jobId,
    };
  }

  function getCompleteJobsInfo(): Record<string, { type: string; title: string; success: boolean }> {
    return completeJobsInfo.value;
  }

  function setCompleteJobsInfo(payload: {
    datasetId: string;
    type: string;
    title: string;
    success: boolean;
  }): void {
    completeJobsInfo.value[payload.datasetId] = {
      type: payload.type,
      title: payload.title,
      success: payload.success,
    };
  }

  function removeCompleteJobsInfo(payload: { datasetId: string }): void {
    if (payload.datasetId in completeJobsInfo.value) {
      delete completeJobsInfo.value[payload.datasetId];
    }
  }

  function getRunningJobIds(): boolean {
    return runningJobIds.value;
  }

  function getDatasetRunningState(datasetId: string): string | false {
    if (
      datasetId in datasetStatus.value
      && !NonRunningStates.includes(datasetStatus.value[datasetId].status)
    ) {
      return `/girder/#job/${datasetStatus.value[datasetId].jobId}`;
    }
    return false;
  }

  function getDatasetCompleteJobs(datasetId: string):
  | false
  | { type: string; title: string; success: boolean } {
    if (datasetId in completeJobsInfo.value) {
      return completeJobsInfo.value[datasetId];
    }
    return false;
  }

  function removeCompleteJob(payload: { datasetId: string }): void {
    removeCompleteJobsInfo(payload);
  }

  return {
    jobIds,
    datasetStatus,
    completeJobsInfo,
    runningJobIds,
    getJobIds,
    setJobState,
    getDatasetStatus,
    setDatasetStatus,
    getCompleteJobsInfo,
    setCompleteJobsInfo,
    removeCompleteJobsInfo,
    getRunningJobIds,
    getDatasetRunningState,
    getDatasetCompleteJobs,
    removeCompleteJob,
  };
}

function updateJobFromMessage(job: GirderJob & { type?: string; title?: string }) {
  const jobs = useJobs();
  jobs.setJobState({ jobId: job._id, value: job.status });
  if (typeof job.dataset_id === 'string') {
    jobs.setDatasetStatus({
      datasetId: job.dataset_id,
      status: job.status,
      jobId: job._id,
    });
    if (['pipelines', 'convert'].includes(job.type || '') && NonRunningStates.includes(job.status)) {
      jobs.setCompleteJobsInfo({
        datasetId: job.dataset_id,
        type: job.type || '',
        title: job.title || '',
        success: job.status === JobStatus.SUCCESS.value,
      });
    }
  }
}

export async function initJobs(): Promise<void> {
  const { data: runningJobs } = await girderRest.get<GirderJob[]>('/job', {
    params: { statuses: `[${JobStatus.RUNNING.value}, ${JobStatus.QUEUED.value}, ${JobStatus.INACTIVE.value}]` },
  });
  runningJobs.forEach(updateJobFromMessage);
  getNotificationBus().bus.on('message:job_status', (notification: { data?: GirderJob } & GirderJob) => {
    const job = notification.data || notification;
    updateJobFromMessage(job);
    eventBus.$emit('refresh-data-browser');
  });
}
