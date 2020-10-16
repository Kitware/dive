import { Module } from 'vuex';
import { GirderModel } from '@girder/components/src';

export interface LocationState {
    location: null | GirderModel;
}

const locationModule: Module<LocationState, never> = {
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
