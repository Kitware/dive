import { Module } from 'vuex';
import { GirderModel } from '@girder/components/src';

import { LocationState, RootState } from './types';

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
