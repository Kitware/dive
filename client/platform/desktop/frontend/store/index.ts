import { Api, Pipe } from 'viame-web-common/apispec';
import * as api from 'platform/desktop/frontend/api';
import { getDataset, getRecents, RecentsKey } from './dataset';
import { getOrCreateHistory } from './jobs';

/* Run forward migrations on any client-side data stores */
export async function migrate() {
  const recents = await getRecents();
  if (recents.length && typeof recents[0] === 'string') {
    window.localStorage.setItem(RecentsKey, JSON.stringify([]));
  }
}

/**
 * Wrap API with hooks to use the store
 */
export default function wrap(): Api {
  async function runPipeline(itemId: string, pipeline: Pipe) {
    const job = await api.runPipeline(itemId, pipeline);
    const datasets = job.datasetIds.map(((id) => getDataset(id).value));
    getOrCreateHistory(job, datasets);
  }

  return {
    ...api,
    runPipeline,
  };
}
