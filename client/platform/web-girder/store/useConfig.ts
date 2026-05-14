/* eslint-disable import/prefer-default-export -- singleton composable store */
import { ref } from 'vue';

import { getConfig } from 'platform/web-girder/api/configuration.service';

export interface ConfigState {
  distributedWorkerEnabled: boolean;
  pipelinesEnabled: boolean;
  trainingEnabled: boolean;
}

const distributedWorkerEnabled = ref(false);
const pipelinesEnabled = ref(false);
const trainingEnabled = ref(false);

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

  function setCapabilities(payload: Partial<ConfigState>): void {
    distributedWorkerEnabled.value = payload.distributedWorkerEnabled ?? false;
    pipelinesEnabled.value = payload.pipelinesEnabled ?? false;
    trainingEnabled.value = payload.trainingEnabled ?? false;
  }

  async function loadConfig(): Promise<void> {
    const { data } = await getConfig();
    setCapabilities({
      distributedWorkerEnabled: !!data.distributedWorker,
      pipelinesEnabled: !!data.pipelinesEnabled,
      trainingEnabled: !!data.trainingEnabled,
    });
  }

  return {
    distributedWorkerEnabled,
    pipelinesEnabled,
    trainingEnabled,
    getDistributedWorkerEnabled,
    setDistributedWorkerEnabled,
    getPipelinesEnabled,
    setPipelinesEnabled,
    getTrainingEnabled,
    setTrainingEnabled,
    setCapabilities,
    loadConfig,
  };
}
