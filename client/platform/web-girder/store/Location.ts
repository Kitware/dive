import type { Module } from 'vuex';
import type { GirderModel } from '@girder/components/src';
import { getPathFromLocation } from 'platform/web-girder/utils';
import { getFolder } from 'platform/web-girder/api';
import {
  isGirderModel,
  LocationState, RootState, LocationType,
} from './types';
import router from '../router';

const locationModule: Module<LocationState, RootState> = {
  namespaced: true,
  state: {
    location: null,
    selected: [] as GirderModel[],
  },
  mutations: {
    setLocation(state, location: LocationType) {
      state.location = location;
    },
    setSelected(state, selected: GirderModel[]) {
      state.selected = selected;
    },
  },
  getters: {
    locationIsViameFolder(state) {
      if (isGirderModel(state.location)) {
        return !!state.location?.meta?.annotate;
      }
      return false;
    },
  },
  actions: {
    async route({ commit, getters }, location: LocationType) {
      /* Prevent navigation into auxiliary folder */
      if (
        isGirderModel(location)
        && getters.locationIsViameFolder
        && location.name === 'auxiliary'
      ) {
        return;
      }
      const newPath = getPathFromLocation(location);
      if (newPath !== router.currentRoute.path) {
        router.push(newPath);
      }
      commit('setLocation', location);
      /* Hydrate full location girder model if it's not available */
      if (
        isGirderModel(location)
        && location._modelType === 'folder'
        && !location.name
      ) {
        commit('setLocation', (await getFolder(location._id)).data);
      }
    },
  },
};

export default locationModule;
