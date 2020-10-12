import { Module } from 'vuex';
import { getPipelineList, Category } from 'viame-web-common/api/viame.service';

export interface PipelineState {
    pipelines: null | Record<string, Category>;
}

const pipelineModule: Module<PipelineState, never> = {
  namespaced: true,
  state: {
    pipelines: null,
  },
  mutations: {
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
};

export default pipelineModule;
