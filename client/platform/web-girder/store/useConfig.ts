/* eslint-disable import/prefer-default-export -- singleton composable store */
import { ref } from 'vue';

import {
  DEFAULT_JOBS_DISABLED_MESSAGE,
  getConfig,
} from 'platform/web-girder/api/configuration.service';

export interface ConfigState {
  distributedWorkerEnabled: boolean;
  pipelinesEnabled: boolean;
  trainingEnabled: boolean;
  jobsDisabled: boolean;
  jobsDisabledMessage: string;
}

const distributedWorkerEnabled = ref(false);
const pipelinesEnabled = ref(false);
const trainingEnabled = ref(false);
const jobsDisabled = ref(false);
const jobsDisabledMessage = ref(DEFAULT_JOBS_DISABLED_MESSAGE);

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

  function setCapabilities(payload: Partial<ConfigState>): void {
    distributedWorkerEnabled.value = payload.distributedWorkerEnabled ?? false;
    pipelinesEnabled.value = payload.pipelinesEnabled ?? false;
    trainingEnabled.value = payload.trainingEnabled ?? false;
    jobsDisabled.value = payload.jobsDisabled ?? false;
    jobsDisabledMessage.value = payload.jobsDisabledMessage || DEFAULT_JOBS_DISABLED_MESSAGE;
  }

  async function loadConfig(): Promise<void> {
    const { data } = await getConfig();
    setCapabilities({
      distributedWorkerEnabled: !!data.distributedWorker,
      pipelinesEnabled: !!data.pipelinesEnabled,
      trainingEnabled: !!data.trainingEnabled,
      jobsDisabled: !!data.jobsDisabled,
      jobsDisabledMessage: data.jobsDisabledMessage || DEFAULT_JOBS_DISABLED_MESSAGE,
    });
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
  };
}
