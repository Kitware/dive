import { Api } from 'dive-common/apispec';
import * as api from 'platform/desktop/frontend/api';

import { load, setRecents } from './dataset';

/* Run forward migrations on any client-side data stores */
export async function migrate() {
  /* No migrations yet */
  await load();
}

/**
 * Wrap API with hooks to use the store
 */
export default function wrap(): Api {
  async function loadMetadata(datasetId: string) {
    const meta = await api.loadMetadata(datasetId);
    if (!datasetId.includes('/')) { // Only update if not multiCam
      setRecents(meta, (new Date()).toString());
    }
    return meta;
  }

  async function loadDetections(datasetId: string) {
    return api.loadDetections(datasetId);
  }

  return {
    ...api,
    loadDetections,
    loadMetadata,
  };
}
