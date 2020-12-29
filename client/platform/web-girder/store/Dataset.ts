import { GirderModel } from '@girder/components/src';
import { Module } from 'vuex';

import { ImageSequenceType, VideoType } from 'viame-web-common/constants';
import { DatasetMeta, FrameImage } from 'viame-web-common/apispec';

import { getFolder, getItemDownloadUri } from '../api/girder.service';
import { getValidWebImages } from '../api/viame.service';
import { getClipMeta } from '../api/viameDetection.service';

export interface GirderDataset extends GirderModel {
  meta: {
    ffprobe_info?: Record<string, string>;
    annotate: boolean;
  } & DatasetMeta;
}

const defaultFrameRate = 30;

interface DatasetState {
  dataset: GirderDataset | null;
}

const datasetModule: Module<DatasetState, never> = {
  namespaced: true,
  state: {
    dataset: null,
  },
  getters: {
    frameRate(state): number {
      const fps = state.dataset?.meta.fps;
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
      if (!state.dataset) {
        return '';
      } if (state.dataset.meta.type === VideoType) {
        return 'VideoAnnotator';
      } if (state.dataset.meta.type === ImageSequenceType) {
        return 'ImageAnnotator';
      }
      throw new Error(`Unknown dataset type: ${state.dataset.meta.type}`);
    },
  },
  mutations: {
    set(state, { dataset }: { dataset: GirderDataset }) {
      state.dataset = dataset;
    },
  },
  actions: {
    async load({ commit }, datasetId: string): Promise<GirderDataset> {
      const dataset = await getFolder(datasetId) as GirderDataset;
      let videoUrl = '';
      let imageData = [] as FrameImage[];

      if (!dataset) {
        throw new Error(`could not fetch dataset for id ${datasetId}`);
      }

      /* Load media based on dataset */
      if (dataset.meta.type === VideoType) {
        const clipMeta = await getClipMeta(dataset._id);
        if (!clipMeta.videoUrl) {
          throw new Error('Expected clipMeta.videoUrl, but was empty.');
        }
        videoUrl = clipMeta.videoUrl;
      } else if (dataset.meta.type === ImageSequenceType) {
        const items = await getValidWebImages(dataset._id);
        imageData = items.map((item) => ({
          url: getItemDownloadUri(item._id),
          filename: item.name,
        }));
      } else {
        throw new Error(`Unable to load media for dataset type: ${dataset.meta.type}`);
      }
      // These aren't part of the native girder meta, must derive them
      dataset.meta.videoUrl = videoUrl;
      dataset.meta.imageData = imageData;
      commit('set', { dataset });
      commit('Location/setLocation', {
        _id: dataset.parentId,
        _modelType: dataset.parentCollection,
      }, { root: true });
      return dataset;
    },
  },
};

export default datasetModule;
