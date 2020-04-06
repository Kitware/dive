import Vue from 'vue';
import Vuex from 'vuex';

import girderRest from '@/girder';

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
    location: null,
    pipelines: [],
  },
  mutations: {
    setLocation(state, location) {
      state.location = location;
    },
    setPipelines(state, pipelines) {
      state.pipelines = pipelines;
    },
  },
  actions: {
    async fetchPipelines({ commit }) {
      const { data } = await girderRest.get('viame/pipelines');
      commit('setPipelines', data);
    },
  },
});
