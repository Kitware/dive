import type { Module } from 'vuex';
import type { GirderModel } from '@girder/components/src';
import { getPathFromLocation } from 'platform/web-girder/utils';
import {
  GettersDefinition, isGirderModel, LocationGetters, LocationState, RootState,
} from './types';
import router from '../router';

const getters: GettersDefinition<LocationGetters, LocationState> = {
  locationIsViameFolder(state) {
    if (isGirderModel(state.location)) {
      return !!state.location?.meta?.annotate;
    }
    return false;
  },
};

const locationModule: Module<LocationState, RootState> = {
  namespaced: true,
  state: {
    location: null,
    selected: [] as GirderModel[],
  },
  mutations: {
    setLocation(state, location: GirderModel) {
      state.location = location;
    },
    setSelected(state, selected: GirderModel[]) {
      state.selected = selected;
    },
  },
  getters,
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
