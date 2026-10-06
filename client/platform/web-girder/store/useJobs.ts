import Vue, { computed, ref } from 'vue';
import { GirderJob } from '@girder/components/src';
import { all } from '@girder/components/src/components/Job/status';

import eventBus from 'platform/web-girder/eventBus';
import girderRest from 'platform/web-girder/plugins/girder';

const JobStatus = all();
const NonRunningStates = [
  JobStatus.CANCELED.value,
  JobStatus.ERROR.value,
  JobStatus.SUCCESS.value,
];

/** True once a job reached a terminal state (success, error or canceled). */
export function isJobFinished(status: number): boolean {
  return NonRunningStates.includes(status);
}

/** True for the one terminal state that is not a failure. */
export function jobSucceeded(status: number): boolean {
  return status === JobStatus.SUCCESS.value;
}

/** True when the job ended because someone canceled it. */
export function jobCanceled(status: number): boolean {
  return status === JobStatus.CANCELED.value;
}

export type DatasetJobEntry = { status: number; jobId: string };

const jobIds = ref<Record<string, number>>({});
/**
 * Primary (display) job per dataset: a still-running job when any exist,
 * otherwise the job most recently updated. Consumers like watchPipelineJob
 * watch this single slot.
 */
const datasetStatus = ref<Record<string, DatasetJobEntry>>({});
/** All known jobs for a dataset — split + finalize can share one parent id. */
const datasetJobs = ref<Record<string, Record<string, number>>>({});
const completeJobsInfo = ref<Record<string, { type: string; title: string; success: boolean }>>({});

const runningJobIds = computed(
  () => Object.values(jobIds.value).filter((v) => !NonRunningStates.includes(v)).length >= 1,
);

function pickPrimaryJob(jobsForDataset: Record<string, number>, fallbackJobId: string): DatasetJobEntry {
  const running = Object.entries(jobsForDataset)
    .find(([, status]) => !NonRunningStates.includes(status));
  if (running) {
    return { jobId: running[0], status: running[1] };
  }
  return { jobId: fallbackJobId, status: jobsForDataset[fallbackJobId] };
}

function datasetHasRunningJob(datasetId: string): boolean {
  const jobsForDataset = datasetJobs.value[datasetId];
  if (!jobsForDataset) {
    return false;
  }
  return Object.values(jobsForDataset).some((status) => !NonRunningStates.includes(status));
}

export function useJobs() {
  function getJobIds(): Record<string, number> {
    return jobIds.value;
  }

  function setJobState(payload: { jobId: string; value: number }): void {
    Vue.set(jobIds.value, payload.jobId, payload.value);
  }

  function getDatasetStatus(): Record<string, DatasetJobEntry> {
    return datasetStatus.value;
  }

  /**
   * Record a job status for a dataset. Multiple jobs may share one dataset id
   * (e.g. per-camera split/convert plus multicam finalize). Processing stays
   * true while any of them is non-terminal.
   */
  function setDatasetStatus(payload: { datasetId: string; status: number; jobId: string }): void {
    const { datasetId, status, jobId } = payload;
    if (!datasetJobs.value[datasetId]) {
      Vue.set(datasetJobs.value, datasetId, {});
    }
    Vue.set(datasetJobs.value[datasetId], jobId, status);
    Vue.set(datasetStatus.value, datasetId, pickPrimaryJob(datasetJobs.value[datasetId], jobId));
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
    Vue.set(completeJobsInfo.value, payload.datasetId, {
      type: payload.type,
      title: payload.title,
      success: payload.success,
    });
  }

  function removeCompleteJobsInfo(payload: { datasetId: string }): void {
    if (payload.datasetId in completeJobsInfo.value) {
      Vue.delete(completeJobsInfo.value, payload.datasetId);
    }
  }

  function getRunningJobIds(): boolean {
    return runningJobIds.value;
  }

  function getDatasetRunningState(datasetId: string): string | false {
    const jobsForDataset = datasetJobs.value[datasetId];
    if (!jobsForDataset) {
      return false;
    }
    const running = Object.entries(jobsForDataset)
      .find(([, status]) => !NonRunningStates.includes(status));
    if (!running) {
      return false;
    }
    return `/girder/#job/${running[0]}`;
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
    datasetJobs,
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

/** Apply a Girder job status message to the jobs store. Exported for tests. */
export function updateJobFromMessage(job: GirderJob & { type?: string; title?: string }) {
  const jobs = useJobs();
  jobs.setJobState({ jobId: job._id, value: job.status });
  if (typeof job.dataset_id === 'string') {
    jobs.setDatasetStatus({
      datasetId: job.dataset_id,
      status: job.status,
      jobId: job._id,
    });
    if (
      ['pipelines', 'convert', 'scoring'].includes(job.type || '')
      && NonRunningStates.includes(job.status)
      // Wait until every parent-scoped job is done so a finished camera split
      // does not prompt / clear Processing while finalize is still running.
      && !datasetHasRunningJob(job.dataset_id)
    ) {
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
  girderRest.$on('message:job_status', ({ data: job }: { data: GirderJob }) => {
    updateJobFromMessage(job);
    eventBus.$emit('refresh-data-browser');
  });
}
