import Vue from 'vue';
import Vuex from 'vuex';

import { getPipelineList } from '@/common/viame.service';

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
    async fetchPipelines({ commit, state }) {
      if (state.pipelines.length === 0) {
        const { data } = await getPipelineList();
        commit('setPipelines', data);
        return data;
      }
      return state.pipelines;
    },
  },
});
