import {
  Api, DatasetMetaMutable, Pipe, SaveDetectionsArgs,
} from 'viame-web-common/apispec';
import * as api from 'platform/desktop/api/main';
/**
 * TODO: Danger!
 * These are "backend" methods that involve node.js.  They should not be imported or
 * used from client code.  They should be refactored to run over REST or IPC
 */
import common from 'platform/desktop/backend/platforms/common';

import { settings } from './settings';
import {
  setDataset, getDataset, getRecents, RecentsKey,
} from './dataset';
import { getOrCreateHistory } from './jobs';

/* Run forward migrations on any client-side data stores */
export async function migrate() {
  const recents = await getRecents();
  if (recents.length && typeof recents[0] === 'string') {
    window.localStorage.setItem(RecentsKey, JSON.stringify([]));
  }
}

export async function importMedia(path: string) {
  return common.importMedia(settings.value, path);
}

/**
 * Wrap API with hooks to use the store
 */
export default function wrap(): Api {
  // TODO: see above
  function saveDetections(datasetId: string, args: SaveDetectionsArgs) {
    return common.saveDetections(settings.value, datasetId, args);
  }

  // TODO: see above
  function saveMetadata(datasetId: string, args: DatasetMetaMutable) {
    return common.saveMetadata(settings.value, datasetId, args);
  }

  // TODO: see above
  async function loadDataset(datasetId: string) {
    const addrInfo = await api.mediaServerInfo();
    const ds = await common.loadDataset(settings.value, datasetId, addrInfo);
    setDataset(datasetId, ds);
    return ds;
  }

  async function runPipeline(itemId: string, pipeline: Pipe) {
    const job = await api.runPipeline(itemId, pipeline);
    const datasets = job.datasetIds.map(((id) => getDataset(id).value));
    getOrCreateHistory(job, datasets);
  }

  return {
    ...api,
    loadDataset,
    saveDetections,
    saveMetadata,
    runPipeline,
  };
}
