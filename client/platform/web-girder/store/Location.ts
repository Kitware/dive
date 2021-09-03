import type { Module } from 'vuex';
import type { GirderModel } from '@girder/components/src';
import { Route } from 'vue-router';
import girderRest from 'platform/web-girder/plugins/girder';
import { getLocationFromRoute, getRouteFromLocation } from 'platform/web-girder/utils';
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
      if (state.location && isGirderModel(state.location)) {
        return !!state.location?.meta?.annotate;
      }
      return false;
    },
    defaultLocation() {
      return {
        _id: girderRest.user._id,
        _modelType: 'user',
      };
    },
    locationRoute(state, getters) {
      if (state.location) {
        return getRouteFromLocation(state.location);
      }
      return getRouteFromLocation(getters.defaultLocation);
    },
  },
  actions: {
    async hydrate({ commit }, location: LocationType) {
      if (
        isGirderModel(location)
        && location._modelType === 'folder'
        && !location.name
      ) {
        commit('setLocation', (await getFolder(location._id)).data);
      } else {
        commit('setLocation', location);
      }
    },
    async setLocationFromRoute({ dispatch, state, getters }, route: Route) {
      /**
       * Update the location because the route changed.
       * May need to fetch the full location details from server
       */
      const newLocation = getLocationFromRoute(route) || getters.defaultLocation;
      /** If the current and new location are the same, abort */
      if (state.location) {
        if ('type' in state.location && 'type' in newLocation) {
          if (state.location.type === newLocation.type) return;
        }
        if ('_id' in state.location && '_id' in newLocation) {
          if (state.location._id === newLocation._id) return;
        }
      }
      dispatch('hydrate', newLocation);
    },
    setRouteFromLocation({ getters, dispatch }, location: LocationType) {
      /**
       * Update the current route because the location was changed,
       * such as by navigating within the data browser
       */
      if (
        isGirderModel(location)
        && getters.locationIsViameFolder
        && location.name === 'auxiliary'
      ) {
        /* Prevent navigation into auxiliary folder */
        return;
      }
      const newPath = getRouteFromLocation(location);
      if (newPath !== router.currentRoute.path) {
        router.push(newPath);
      }
      dispatch('hydrate');
    },
  },
};

export default locationModule;
