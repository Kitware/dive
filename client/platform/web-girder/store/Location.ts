import type { Module } from 'vuex';
import type { GirderModel } from '@girder/components/src';
import { getPathFromLocation } from 'platform/web-girder/utils';
import type { LocationState, RootState } from './types';
import router from '../router';

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
  actions: {
    route({ commit }, location: GirderModel) {
      const newPath = getPathFromLocation(location);
      if (newPath !== router.currentRoute.path) {
        router.push(newPath);
      }
      commit('setLocation', location);
    },
  },
};

export default locationModule;
