import { Module } from 'vuex';
import { getValidFileTypes } from '@/lib/api/viame.service';

export interface FiletypeState {
    filetypes: null | Record<string, any>;
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
  getters: {
    getVidRegEx(state) {
      if (state !== null) {
        return new RegExp(`${state.filetypes!.video.join('$|')}$`, 'i');
      }
      return null;
    },
    getImgRegEx(state) {
      if (state !== null) {
        return new RegExp(`${state.filetypes!.image.join('$|')}$`, 'i');
      }
      return null;
    },
    getWebRegEx(state) {
      if (state !== null) {
        return new RegExp(`${state.filetypes!.web.join('$|')}$`, 'i');
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
      return state.filetypes;
    },
  },
};

export default filetypeModule;
