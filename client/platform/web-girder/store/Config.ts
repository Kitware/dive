import { Module } from 'vuex';

import { getConfig } from 'platform/web-girder/api/configuration.service';
import { RootState } from './types';

export interface ConfigState {
  distributedWorkerEnabled: boolean;
  pipelinesEnabled: boolean;
  trainingEnabled: boolean;
}

const configModule: Module<ConfigState, RootState> = {
  namespaced: true,
  state: {
    distributedWorkerEnabled: false,
    pipelinesEnabled: false,
    trainingEnabled: false,
  },
  mutations: {
    setCapabilities(state, payload: Partial<ConfigState>) {
      state.distributedWorkerEnabled = payload.distributedWorkerEnabled ?? false;
      state.pipelinesEnabled = payload.pipelinesEnabled ?? false;
      state.trainingEnabled = payload.trainingEnabled ?? false;
    },
  },
  actions: {
    async load({ commit }) {
      const { data } = await getConfig();
      commit('setCapabilities', {
        distributedWorkerEnabled: !!data.distributedWorker,
        pipelinesEnabled: !!data.pipelinesEnabled,
        trainingEnabled: !!data.trainingEnabled,
      });
    },
  },
};

export default configModule;
