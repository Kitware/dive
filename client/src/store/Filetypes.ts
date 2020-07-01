import { Module } from 'vuex';
import { getValidFileTypes, Types } from '@/lib/api/viame.service';

export interface FiletypeState {
    filetypes: null | Record<string, Types>;
}

const filetypeModule: Module<FiletypeState, never> = {
  namespaced: true,
  state: {
    filetypes: null,
  },
  mutations: {
    setFiletypes(state, filetypes) {
      state.filetypes = filetypes;
    },
  },
  actions: {
    async fetchFiletypes({ commit, state }) {
      if (state.filetypes === null) {
        const { data } = await getValidFileTypes();

        commit('setFileTypes', data);
        return data;
      }
      return state.filetypes;
    },
  },
};

export default filetypeModule;
