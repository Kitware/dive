import type { Module } from 'vuex';
import type { GirderModel } from '@girder/components';
import type { LocationState, RootState } from './types';

const locationModule: Module<LocationState, RootState> = {
  namespaced: true,
  state: {
    location: null,
  },
  mutations: {
    setLocation(state, location: GirderModel) {
      state.location = location;
    },
  },
};

export default locationModule;
