import { Module } from 'vuex';
import { GirderModel } from 'app/api/viame.service';

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
