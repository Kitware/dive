import path from 'path';

import Vue from 'vue';
import { uniq } from 'lodash';
import Install, { ref, computed } from '@vue/composition-api';
import { Api } from 'viame-web-common/apispec';
import * as api from '../api/main';

const RecentsKey = 'desktop.recent';

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

const dsmap = ref({} as Record<string, api.DesktopDataset>);

function getDataset(id: string) {
  return computed(() => dsmap.value[id]);
}

function getRecents(): path.ParsedPath[] {
  const arr = window.localStorage.getItem(RecentsKey);
  let returnVal = [] as path.ParsedPath[];
  try {
    if (arr) {
      const maybeArr = JSON.parse(arr);
      if (maybeArr.length) {
        returnVal = maybeArr.map((p: string) => path.parse(p));
      }
    }
  } catch (err) {
    return returnVal;
  }
  return returnVal;
}

function setRecents(id: string) {
  const recents = getRecents();
  recents.splice(0, 0, path.parse(id)); // verify that it's a valid path
  let recentsStrings = recents.map((r) => path.join(r.dir, r.base));
  recentsStrings = uniq(recentsStrings);
  window.localStorage.setItem(RecentsKey, JSON.stringify(recentsStrings));
}

function setDataset(id: string, ds: api.DesktopDataset) {
  Vue.set(dsmap.value, id, ds);
  setRecents(id);
}

/**
 * Returns wrapped API to update store
 */
function observe(): Api {
  async function loadMetadata(datasetId: string) {
    const ds = await api.loadMetadata(datasetId);
    setDataset(datasetId, ds);
    return ds.meta;
  }
  return {
    ...api,
    loadMetadata,
  };
}

export {
  getDataset,
  setDataset,
  getRecents,
  observe,
};
