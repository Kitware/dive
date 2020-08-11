import { Module } from 'vuex';
import { getValidFileTypes } from 'app/api/viame.service';

export interface FiletypeState {
    filetypes: null | Record<string, string[]>;
}

const filetypeModule: Module<FiletypeState, never> = {
  namespaced: true,
  state: {
    filetypes: null,
  },
  mutations: {
    setFiletypes(state, filetypes: Record<string, string[]>) {
      state.filetypes = filetypes;
    },
  },
  getters: {
    getVidRegEx(state) {
      if (state.filetypes !== null) {
        return new RegExp(`${state.filetypes.video.join('$|')}$`, 'i');
      }
      return null;
    },
    getImgRegEx(state) {
      if (state.filetypes !== null) {
        return new RegExp(`${state.filetypes.image.join('$|')}$`, 'i');
      }
      return null;
    },
    getWebRegEx(state) {
      if (state.filetypes !== null) {
        return new RegExp(`${state.filetypes.web.join('$|')}$`, 'i');
      }
      return null;
    },
  },
  actions: {
    async fetchFiletypes({ commit, state }) {
      if (state.filetypes === null) {
        const { data } = await getValidFileTypes();
        commit('setFiletypes', data);
      }
    },
  },
};

export default filetypeModule;
