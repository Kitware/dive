import Vue from 'vue';
import Vuex from 'vuex';

import { getPipelineList } from '@/lib/api/viame.service';

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
        // Sort list of pipelines in each category by name
        Object.values(data).forEach((category) => {
          category.pipes.sort((a, b) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();
            if (aName > bName) {
              return 1;
            }
            if (aName < bName) {
              return -1;
            }
            return 0;
          });
        });
        commit('setPipelines', data);
        return data;
      }
      return state.pipelines;
    },
  },
});
