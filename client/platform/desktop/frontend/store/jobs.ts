/**
 * Job Manager
 */
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
  JsonMeta,
} from 'platform/desktop/constants';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import AsyncGpuJobQueue from './queues/asyncGpuJobQueue';
import AsyncCpuJobQueue from './queues/asyncCpuJobQueue';
import { setRecents } from './dataset';

interface DesktopJobHistory {
  job: DesktopJob;
  truncatedLogs: string[];
  totalLogLength: number;
  // Set once we've surfaced this job's failure to the user, so the repeated
  // updates that arrive don't re-open the dialog.
  errorNotified?: boolean;
}

const truncateOutputAtLines = 500;
const cancelledJobExitCode = 143; // SIGTERM
const jobHistory: Ref<Record<string, DesktopJobHistory>> = ref({});
const recentHistory = computed(() => Object.values(jobHistory.value));
const runningJobs = computed(() => recentHistory.value.filter((v) => v.job.exitCode === null));

export function updateHistory(args: DesktopJobUpdate) {
  let existing = jobHistory.value[args.key];
  if (!existing) {
    set<DesktopJobHistory>(jobHistory.value, args.key, {
      job: args,
      truncatedLogs: [],
      totalLogLength: 0,
    });
    existing = jobHistory.value[args.key];
  }
  // If job is cancelled we should stop updating data
  if (existing.job.cancelledJob) {
    return;
  }
  if (args.body) {
    /* Prevent logs filling memory and causing render slowdowns */
    existing.truncatedLogs.push(...args.body);
    existing.truncatedLogs.splice(0, existing.truncatedLogs.length - truncateOutputAtLines);
    existing.totalLogLength += args.body.length;
  }
  // Only update exitCode if explicitly set
  if (args.exitCode !== undefined) {
    existing.job.exitCode = args.exitCode;
  }
  // Only update cancelledJob if explicitly set to true (preserve true once set)
  if (args.cancelledJob === true) {
    existing.job.cancelledJob = true;
    existing.job.exitCode = cancelledJobExitCode; // SIGTERM
  }
  if (args.endTime !== undefined) {
    existing.job.endTime = args.endTime;
  }

  // Surface a failed job's error to the user. The process reports the cause on
  // lines beginning with "ERROR:" (DIVE convention); we only prompt when the
  // job has actually exited with a non-zero, non-cancellation code and at
  // least one such line was captured.
  const finished = existing.job.endTime !== undefined;
  const failed = existing.job.exitCode !== null
    && existing.job.exitCode !== 0
    && existing.job.exitCode !== cancelledJobExitCode
    && !existing.job.cancelledJob;
  if (finished && failed && !existing.errorNotified) {
    existing.errorNotified = true;
    const errorLines = existing.truncatedLogs
      .map((line) => line.trim())
      .filter((line) => line.startsWith('ERROR:'))
      .map((line) => line.replace(/^ERROR:\s*/, ''));
    if (errorLines.length > 0) {
      try {
        const { prompt } = usePrompt();
        prompt({
          title: `${existing.job.title || 'Job'} failed`,
          text: errorLines,
          positiveButton: 'OK',
        });
      } catch {
        // Prompt service not available (e.g. very early startup); the error
        // is still visible in the job log.
      }
    }
  }
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
  window.diveDesktop.on('job-update', (args: DesktopJobUpdate) => {
    updateHistory(args);
    if (args.jobType === 'conversion') {
      setOrGetConversionJob(args.datasetIds[0], !args.endTime);
    }
  });
  window.diveDesktop.on('cancel-job', (args: DesktopJob) => {
    updateHistory({
      ...args, body: ['Job cancelled by user'], exitCode: cancelledJobExitCode, endTime: new Date(), cancelledJob: true,
    });
  });
  window.diveDesktop.on('filter-complete', (args: JsonMeta) => {
    setRecents(args);
  });
}

init();

const gpuJobQueue = new AsyncGpuJobQueue(window.diveDesktop);
gpuJobQueue.init();
const reactiveGpuQueue = reactive(gpuJobQueue);

const cpuJobQueue = new AsyncCpuJobQueue(window.diveDesktop);
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
