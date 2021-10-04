import type { Module } from 'vuex';
import type { GirderMetadata } from 'platform/web-girder/constants';
import { getDataset, getDatasetMedia, getFolder } from 'platform/web-girder/api';
import { MultiType } from 'dive-common/constants';
import type { DatasetState, RootState } from './types';


const datasetModule: Module<DatasetState, RootState> = {
  namespaced: true,
  state: {
    meta: null,
  },
  mutations: {
    set(state, { dataset }: { dataset: GirderMetadata }) {
      state.meta = dataset;
    },
  },
  actions: {
    async load({ commit, dispatch }, datasetId: string): Promise<GirderMetadata> {
      const [folder, metaStatic, media] = await Promise.all([
        getFolder(datasetId),
        getDataset(datasetId),
        getDatasetMedia(datasetId),
      ]);
      const dsMeta = {
        ...metaStatic.data,
        ...media.data,
        videoUrl: media.data.video?.url,
      };
      // TODO remove when multi is supported in web
      if (dsMeta.type === MultiType) {
        throw new Error('multi is not supported on web yet');
      }
      commit('set', { dataset: dsMeta });
      const { parentId, parentCollection } = folder.data;
      if (parentId && parentCollection) {
        dispatch('Location/hydrate', {
          _id: parentId,
          _modelType: parentCollection,
        }, { root: true });
      } else {
        throw new Error(`dataset ${datasetId} was not a valid girder folder`);
      }
      return dsMeta;
    },
  },
};

export default datasetModule;
