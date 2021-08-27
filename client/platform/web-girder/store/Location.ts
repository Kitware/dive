import type { Module } from 'vuex';
import { getPathFromLocation } from 'platform/web-girder/utils';
import type { LocationState, LocationType, RootState } from './types';
import router from '../router';

const locationModule: Module<LocationState, RootState> = {
  namespaced: true,
  state: {
    location: null,
  },
  mutations: {
    setLocation(state, location: LocationType) {
      state.location = location;
    },
  },
  actions: {
    route({ commit }, location: LocationType) {
      const newPath = getPathFromLocation(location);
      if (newPath !== router.currentRoute.path) {
        router.push(newPath);
      }
      commit('setLocation', location);
    },
  },
};

export default locationModule;
