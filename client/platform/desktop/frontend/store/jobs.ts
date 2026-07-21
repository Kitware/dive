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
const cancelledJobExitCode = 143; // SIGTERM (128 + 15)
// A finished process that still reports a null exit code was killed by a signal
// (e.g. SIGSEGV from a native crash, or SIGKILL from the OOM killer) rather than
// exiting normally. Node surfaces that as a null code, and every job-status
// check in the desktop UI treats exitCode === null as "still running" (the
// indeterminate spinner / progress bar). So a crashed job must never be left
// with a null code -- we normalize it to this conventional "killed by signal"
// value. The renderer is not given the signal name, so one generic code is used.
const abnormalTerminationExitCode = 139; // 128 + SIGSEGV (11)
const jobHistory: Ref<Record<string, DesktopJobHistory>> = ref({});
const recentHistory = computed(() => Object.values(jobHistory.value));
// A job is still running until it reports an endTime. Do NOT key this off
// exitCode === null: a process killed by a signal (e.g. a segfault or OOM kill)
// also reports a null exit code, which would otherwise pin the job as "running"
// forever even though it has already exited.
const runningJobs = computed(() => recentHistory.value.filter((v) => v.job.endTime === undefined));

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
    set(existing.job, 'exitCode', args.exitCode);
  }
  // Only update cancelledJob if explicitly set to true (preserve true once set)
  if (args.cancelledJob === true) {
    set(existing.job, 'cancelledJob', true);
    set(existing.job, 'exitCode', cancelledJobExitCode); // SIGTERM
  }
  // `endTime` (like `cancelledJob`) does not exist on the job object until a
  // job finishes. Vue 2 cannot observe properties added by plain assignment,
  // so these must go through set() or the `runningJobs` computed (and with it
  // the job spinner and the dataset read-only lock) never re-evaluates.
  if (args.endTime !== undefined) {
    set(existing.job, 'endTime', args.endTime);
  }

  // A job that has finished (endTime set) but still carries a null exitCode was
  // killed by a signal, not exited normally. Normalize it to a non-null failure
  // code here, at the single update funnel, so that every downstream check that
  // reads "exitCode === null" as "still running" -- the job-row spinner and
  // progress bar in JobsHistory, the running badge, the in-progress cancel
  // action -- correctly renders it as a failed job instead of one that spins
  // forever.
  if (existing.job.endTime !== undefined
      && existing.job.exitCode === null
      && !existing.job.cancelledJob) {
    set(existing.job, 'exitCode', abnormalTerminationExitCode);
  }

  // Surface a failed job to the user with a single dialog once it exits with a
  // non-zero, non-cancellation code. The process reports a cause on lines
  // beginning with "ERROR:" (DIVE convention); when present we show those,
  // otherwise we fall back to a generic message so failures are never silent.
  const finished = existing.job.endTime !== undefined;
  // A finished job that did not exit cleanly (0) and was not cancelled has
  // failed. This deliberately includes exitCode === null, which is how a
  // process killed by a signal (e.g. a segfault) reports -- such crashes must
  // not be silent.
  const failed = finished
    && !existing.job.cancelledJob
    && existing.job.exitCode !== 0
    && existing.job.exitCode !== cancelledJobExitCode;
  if (finished && failed && !existing.errorNotified) {
    existing.errorNotified = true;
    const errorLines = existing.truncatedLogs
      .map((line) => line.trim())
      .filter((line) => line.startsWith('ERROR:'))
      .map((line) => line.replace(/^ERROR:\s*/, ''));
    const text = errorLines.length > 0
      ? errorLines
      : [
        existing.job.exitCode === abnormalTerminationExitCode
          ? 'The job terminated unexpectedly -- it was killed by a signal, usually a native crash (segfault) or an out-of-memory kill.'
          : `The job exited unexpectedly (exit code ${existing.job.exitCode}).`,
        'Open it from the Jobs page to view the full log.',
      ];
    try {
      const { prompt } = usePrompt();
      prompt({
        title: `${existing.job.title || 'Job'} failed`,
        text,
        positiveButton: 'OK',
      });
    } catch {
      // Prompt service not available (e.g. very early startup); the error
      // is still visible in the job log.
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
