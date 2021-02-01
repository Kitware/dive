import { Module } from 'vuex';

import { ImageSequenceType, VideoType } from 'viame-web-common/constants';
import type { FrameImage } from 'viame-web-common/apispec';
import type { GirderMetadataStatic, GirderMetadata } from 'platform/web-girder/constants';

import { getFolder, getItemDownloadUri } from '../api/girder.service';
import { getValidWebImages } from '../api/viame.service';
import { getClipMeta } from '../api/viameDetection.service';

import { DatasetState, RootState } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isGirderDatasetMeta(obj: any): obj is GirderMetadataStatic {
  if (obj.annotate !== true) {
    return false;
  }
  if (!(typeof obj.type === 'string')) {
    return false;
  }
  if (!(typeof obj.id === 'string')) {
    return false;
  }
  return true;
}

const defaultFrameRate = 30;

const datasetModule: Module<DatasetState, RootState> = {
  namespaced: true,
  state: {
    meta: null,
  },
  getters: {
    frameRate(state): number {
      const fps = state.meta?.fps;
      if (fps) {
        if (typeof fps === 'string') {
          const parsed = parseInt(fps, 10);
          if (Number.isNaN(parsed)) {
            throw new Error(`Cannot parse fps=${fps} as integer`);
          }
          return parsed;
        }
      }
      return defaultFrameRate;
    },
    annotatorType(state): 'ImageAnnotator'|'VideoAnnotator'|'' {
      if (!state.meta) {
        return '';
      } if (state.meta.type === VideoType) {
        return 'VideoAnnotator';
      } if (state.meta.type === ImageSequenceType) {
        return 'ImageAnnotator';
      }
      throw new Error(`Unknown dataset type: ${state.meta.type}`);
    },
  },
  mutations: {
    set(state, { dataset }: { dataset: GirderMetadata }) {
      state.meta = dataset;
    },
  },
  actions: {
    async load({ commit }, datasetId: string): Promise<GirderMetadata> {
      const girderDataset = await getFolder(datasetId);
      const dsMeta = {
        id: girderDataset._id,
        ...girderDataset,
        ...(girderDataset.meta as Record<string, unknown>),
      };

      let videoUrl = '';
      let imageData = [] as FrameImage[];

      if (!dsMeta) {
        throw new Error(`could not fetch dataset for id ${datasetId}`);
      }

      if (!isGirderDatasetMeta(dsMeta)) {
        throw new Error(`girder folder ${datasetId} could not be parsed as dataset`);
      }

      /* Load media based on dataset */
      if (dsMeta.type === VideoType) {
        const clipMeta = await getClipMeta(dsMeta._id);
        if (!clipMeta.videoUrl) {
          throw new Error('Expected clipMeta.videoUrl, but was empty.');
        }
        videoUrl = clipMeta.videoUrl;
      } else if (dsMeta.type === ImageSequenceType) {
        const items = await getValidWebImages(dsMeta._id);
        imageData = items.map((item) => ({
          url: getItemDownloadUri(item._id),
          filename: item.name,
        }));
      } else {
        throw new Error(`Unable to load media for dataset type: ${dsMeta.type}`);
      }
      // These aren't part of the native girder meta, must derive them
      const meta: GirderMetadata = {
        ...dsMeta,
        videoUrl,
        imageData,
      };
      commit('set', { dataset: meta });
      commit('Location/setLocation', {
        _id: dsMeta.parentId,
        _modelType: dsMeta.parentCollection,
      }, { root: true });
      return meta;
    },
  },
};

export default datasetModule;
