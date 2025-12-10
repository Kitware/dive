/**
 * Job Manager
 */
import { ipcRenderer } from 'electron';
import {
  ref, Ref, set, computed,
  reactive,
} from 'vue';
import {
  ConversionArgs,
  DesktopJob,
  DesktopJobUpdate,
  ExportTrainedPipeline,
  JobArgs,
  JobType,
  RunPipeline,
  RunTraining,
} from 'platform/desktop/constants';
import AsyncGpuJobQueue from './queues/asyncGpuJobQueue';
import AsyncCpuJobQueue from './queues/asyncCpuJobQueue';

interface DesktopJobHistory {
  job: DesktopJob;
  truncatedLogs: string[];
  totalLogLength: number;
}

const truncateOutputAtLines = 500;
const jobHistory: Ref<Record<string, DesktopJobHistory>> = ref({});
const recentHistory = computed(() => Object.values(jobHistory.value));
const runningJobs = computed(() => recentHistory.value.filter((v) => v.job.exitCode === null));

function updateHistory(args: DesktopJobUpdate) {
  let existing = jobHistory.value[args.key];
  if (!existing) {
    set<DesktopJobHistory>(jobHistory.value, args.key, {
      job: args,
      truncatedLogs: [],
      totalLogLength: 0,
    });
    existing = jobHistory.value[args.key];
  }
  if (args.body) {
    /* Prevent logs filling memory and causing render slowdowns */
    existing.truncatedLogs.push(...args.body);
    existing.truncatedLogs.splice(0, existing.truncatedLogs.length - truncateOutputAtLines);
    existing.totalLogLength += args.body.length;
  }
  existing.job.exitCode = args.exitCode;
  existing.job.endTime = args.endTime;
}

const conversionJob: Ref<Record<string, boolean>> = ref({});

/**
 * Locally stored coversion job in progress
 * Used to indicate in recents that data is disabled until conversion completes
 */
function setOrGetConversionJob(datasetId: string, status?: boolean) {
  let existing = conversionJob.value[datasetId];
  if (!existing) {
    existing = conversionJob.value[datasetId];
  }
  if (status !== undefined) {
    set(conversionJob.value, datasetId, status);
  }
  return existing;
}

function init() {
  ipcRenderer.on('job-update', (event, args: DesktopJobUpdate) => {
    updateHistory(args);
    if (args.jobType === 'conversion') {
      setOrGetConversionJob(args.datasetIds[0], !args.endTime);
    }
  });
}

init();

const gpuJobQueue = new AsyncGpuJobQueue(ipcRenderer);
gpuJobQueue.init();
const reactiveGpuQueue = reactive(gpuJobQueue);

const cpuJobQueue = new AsyncCpuJobQueue(ipcRenderer);
cpuJobQueue.init();
const reactiveCpuQueue = reactive(cpuJobQueue);

const queuedCpuJobs = computed(() => reactiveCpuQueue.jobSpecs);
const queuedGpuJobs = computed(() => reactiveGpuQueue.jobSpecs);

function removeJobFromQueue(jobArgs: JobArgs) {
  switch (jobArgs.type) {
    case JobType.Conversion:
    case JobType.ExportTrainedPipeline:
      cpuJobQueue.removeJobFromQueue(jobArgs as ConversionArgs | ExportTrainedPipeline);
      break;
    case JobType.RunPipeline:
    case JobType.RunTraining:
      gpuJobQueue.removeJobFromQueue(jobArgs as RunPipeline | RunTraining);
      break;
    default:
      break;
  }
}

export {
  jobHistory,
  recentHistory,
  runningJobs,
  setOrGetConversionJob,
  truncateOutputAtLines,
  gpuJobQueue,
  cpuJobQueue,
  reactiveCpuQueue,
  reactiveGpuQueue,
  queuedCpuJobs,
  queuedGpuJobs,
  removeJobFromQueue,
};
