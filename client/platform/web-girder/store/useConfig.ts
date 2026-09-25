import { ref } from 'vue';

import {
  DEFAULT_JOBS_DISABLED_MESSAGE,
  getConfig,
} from 'platform/web-girder/api/configuration.service';
import { getInteractiveStatus } from 'platform/web-girder/api/interactive.service';
import { serverStereoMethods, type StereoMatchMethod } from 'dive-common/use/stereo/stereoMatcher';

export interface ConfigState {
  distributedWorkerEnabled: boolean;
  pipelinesEnabled: boolean;
  trainingEnabled: boolean;
  jobsDisabled: boolean;
  jobsDisabledMessage: string;
  interactiveEnabled: boolean;
  interactiveMessage: string;
  interactiveStereoMethods: StereoMatchMethod[];
  interactiveTextQuery: boolean;
}

const distributedWorkerEnabled = ref(false);
const pipelinesEnabled = ref(false);
const trainingEnabled = ref(false);
const jobsDisabled = ref(false);
const jobsDisabledMessage = ref(DEFAULT_JOBS_DISABLED_MESSAGE);
const interactiveEnabled = ref(false);
const interactiveMessage = ref('');
const interactiveTextQuery = ref(false);

export function useConfig() {
  function getDistributedWorkerEnabled(): boolean {
    return distributedWorkerEnabled.value;
  }

  function setDistributedWorkerEnabled(value: boolean): void {
    distributedWorkerEnabled.value = value;
  }

  function getPipelinesEnabled(): boolean {
    return pipelinesEnabled.value;
  }

  function setPipelinesEnabled(value: boolean): void {
    pipelinesEnabled.value = value;
  }

  function getTrainingEnabled(): boolean {
    return trainingEnabled.value;
  }

  function setTrainingEnabled(value: boolean): void {
    trainingEnabled.value = value;
  }

  function getJobsDisabled(): boolean {
    return jobsDisabled.value;
  }

  function setJobsDisabled(value: boolean): void {
    jobsDisabled.value = value;
  }

  function getJobsDisabledMessage(): string {
    return jobsDisabledMessage.value;
  }

  function setJobsDisabledMessage(value: string): void {
    jobsDisabledMessage.value = value || DEFAULT_JOBS_DISABLED_MESSAGE;
  }

  function setInteractive(payload: {
    interactiveEnabled?: boolean;
    interactiveMessage?: string;
    interactiveStereoMethods?: string[];
    interactiveTextQuery?: boolean;
  }): void {
    interactiveEnabled.value = !!payload.interactiveEnabled;
    interactiveMessage.value = payload.interactiveMessage || '';
    interactiveTextQuery.value = !!payload.interactiveTextQuery;
    // Methods the server can run are offered in the settings even when the
    // browser could not run them itself.
    serverStereoMethods.value = (payload.interactiveStereoMethods || []) as StereoMatchMethod[];
  }

  function setCapabilities(payload: Partial<ConfigState>): void {
    distributedWorkerEnabled.value = payload.distributedWorkerEnabled ?? false;
    pipelinesEnabled.value = payload.pipelinesEnabled ?? false;
    trainingEnabled.value = payload.trainingEnabled ?? false;
    jobsDisabled.value = payload.jobsDisabled ?? false;
    jobsDisabledMessage.value = payload.jobsDisabledMessage || DEFAULT_JOBS_DISABLED_MESSAGE;
    setInteractive(payload);
  }

  async function loadConfig(): Promise<void> {
    const { data } = await getConfig();
    setCapabilities({
      distributedWorkerEnabled: !!data.distributedWorker,
      pipelinesEnabled: !!data.pipelinesEnabled,
      trainingEnabled: !!data.trainingEnabled,
      jobsDisabled: !!data.jobsDisabled,
      jobsDisabledMessage: data.jobsDisabledMessage || DEFAULT_JOBS_DISABLED_MESSAGE,
      interactiveEnabled: !!data.interactiveEnabled,
      interactiveMessage: data.interactiveMessage || '',
      interactiveStereoMethods: (data.interactiveStereoMethods || []) as StereoMatchMethod[],
      interactiveTextQuery: !!data.interactiveTextQuery,
    });
  }

  /** Re-check the interactive service, whose availability follows the job queue. */
  async function refreshInteractive(): Promise<boolean> {
    try {
      setInteractive(await getInteractiveStatus());
    } catch {
      setInteractive({ interactiveEnabled: false, interactiveMessage: 'The interactive service could not be reached.' });
    }
    return interactiveEnabled.value;
  }

  return {
    distributedWorkerEnabled,
    pipelinesEnabled,
    trainingEnabled,
    jobsDisabled,
    jobsDisabledMessage,
    getDistributedWorkerEnabled,
    setDistributedWorkerEnabled,
    getPipelinesEnabled,
    setPipelinesEnabled,
    getTrainingEnabled,
    setTrainingEnabled,
    getJobsDisabled,
    setJobsDisabled,
    getJobsDisabledMessage,
    setJobsDisabledMessage,
    setCapabilities,
    loadConfig,
    interactiveEnabled,
    interactiveMessage,
    interactiveTextQuery,
    refreshInteractive,
  };
}
