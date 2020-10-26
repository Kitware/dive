import { Api, Pipe } from 'viame-web-common/apispec';
import * as api from '../api/main';

import { settings } from './settings';
import { setDataset, getDataset } from './dataset';
import { getOrCreateHistory } from './jobs';

/**
 * Wrap API with hooks to use the store
 */
export default function wrap(): Api {
  async function loadMetadata(datasetId: string) {
    const ds = await api.loadMetadata(datasetId);
    setDataset(datasetId, ds);
    return ds.meta;
  }

  async function getPipelineList() {
    return api.getPipelineList(settings.value);
  }

  async function runPipeline(itemId: string, pipeline: Pipe) {
    const job = await api.runPipeline(itemId, pipeline, settings.value);
    const datasets = job.datasetIds.map(((id) => getDataset(id).value));
    getOrCreateHistory(job, datasets);
  }

  return {
    ...api,
    loadMetadata,
    getPipelineList,
    runPipeline,
  };
}
