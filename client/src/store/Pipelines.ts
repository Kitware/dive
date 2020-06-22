import { getPipelineList } from '@/lib/api/viame.service';

interface Pipe {
    name: string;
    pipe: string;
    type: string;
}
interface Categories {
    description: string;
    pipes: [Pipe];
}
interface PipelineType {
    pipelines: null | Record<string, Categories>;
}

export interface PiplineState {
    pipelines: PipelineType;
}

interface ActionParams {
    commit: (mutation: string, pipelines: PipelineType) => void;
    state: PiplineState;
}

export default {
  namespaced: true,
  state: {
    pipelines: null,
  },
  mutations: {
    setPipelines(state: PiplineState, pipelines: PipelineType) {
      state.pipelines = pipelines;
    },
  },
  actions: {
    async fetchPipelines({ commit, state }: ActionParams) {
      if (state.pipelines === null) {
        const { data } = await getPipelineList() as {data: PipelineType};
        // Sort list of pipelines in each category by name
        Object.values(data).forEach((category) => {
          category.pipes.sort((a: Pipe, b: Pipe) => {
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
