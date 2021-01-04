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
  datasets: string[];
}

const jobHistory: Ref<Record<string, DesktopJobHistory>> = ref({});
const recentHistory = computed(() => Object.values(jobHistory.value));
const runningJobs = computed(() => recentHistory.value.filter((v) => v.job.exitCode === null));

function getOrCreateHistory(args: DesktopJob, datasets?: string[]): DesktopJobHistory {
  let existing = jobHistory.value[args.key];
  if (!existing) {
    set<DesktopJobHistory>(jobHistory.value, args.key, {
      job: args,
      logs: [],
      datasets: datasets || [],
    });
    existing = jobHistory.value[args.key];
  }
  return existing;
}

function updateHistory(args: DesktopJobUpdate) {
  const existing = getOrCreateHistory(args);
  if (args.body) {
    existing.logs.push(...args.body);
  }
  existing.job.exitCode = args.exitCode;
  existing.job.endTime = args.endTime;
}

function init() {
  ipcRenderer.on('job-update', (event, args: DesktopJobUpdate) => {
    updateHistory(args);
  });
}

init();

export {
  getOrCreateHistory,
  jobHistory,
  recentHistory,
  runningJobs,
};
