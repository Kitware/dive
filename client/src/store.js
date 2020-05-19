import Vue from 'vue';
import Vuex from 'vuex';

import { getPipelineList } from '@/common/viame.service';

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
    location: null,
    pipelines: null,
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
      if (state.pipelines === null) {
        const { data } = await getPipelineList();
        Object.keys(data).forEach((key) => {
          const category = data[key];
          if (category.pipes.length > 0) {
            category.pipes.sort((a, b) => {
              if (a.name && b.name) {
                const aName = a.name.toUpperCase();
                const bName = b.name.toUpperCase();
                if (aName > bName) {
                  return 1;
                }
                if (aName < bName) {
                  return -1;
                }
              }
              return 0;
            });
          }
        });
        commit('setPipelines', data);
        return data;
      }
      return state.pipelines;
    },
  },
});
