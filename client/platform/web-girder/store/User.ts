import { merge } from 'lodash';
import { Module } from 'vuex';

import type { UserState, RootState } from './types';
import girderRest from '../plugins/girder';

const userModule: Module<UserState, RootState> = {
  namespaced: true,
  state: {
    user: null,
  },
  mutations: {
    setUserState(state, data: UserState) {
      state.user = merge(state.user, data);
    },
  },
  actions: {
    async loadUser({ commit }) {
      const data = await girderRest.fetchUser();
      commit('setUserState', data);
    },
  },
};

export default userModule;
