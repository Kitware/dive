/**
 * Job Manager
 */
import { ipcRenderer } from 'electron';
import Vue from 'vue';
import Install, {
  ref, Ref, set, computed,
} from '@vue/composition-api';
import { DesktopJob, DesktopJobUpdate } from 'platform/desktop/constants';

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

interface DesktopJobHistory {
  job: DesktopJob;
  logs: string[];
}

const jobHistory: Ref<Record<string, DesktopJobHistory>> = ref({});
const recentHistory = computed(() => Object.values(jobHistory.value));
const runningJobs = computed(() => recentHistory.value.filter((v) => v.job.exitCode === null));

function updateHistory(args: DesktopJobUpdate) {
  let existing = jobHistory.value[args.key];
  if (!existing) {
    set<DesktopJobHistory>(jobHistory.value, args.key, {
      job: args,
      logs: [],
    });
    existing = jobHistory.value[args.key];
  }
  if (args.body) {
    existing.logs.push(...args.body);
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


export {
  jobHistory,
  recentHistory,
  runningJobs,
  setOrGetConversionJob,
};
