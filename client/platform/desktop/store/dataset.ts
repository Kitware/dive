import Vue from 'vue';
import { uniq } from 'lodash';
import Install, { ref, computed } from '@vue/composition-api';
import { Api } from 'viame-web-common/apispec';
import * as api from '../api/main';

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

const dsmap = ref({} as Record<string, api.DesktopDataset>);

function getDataset(id: string) {
  return computed(() => dsmap.value[id]);
}

function getRecents(): string[] {
  const arrStr = window.localStorage.getItem('recent');
  let returnVal = [] as string[];
  try {
    if (arrStr) {
      const maybeArr = JSON.parse(arrStr);
      if (maybeArr.length) {
        returnVal = maybeArr as string[];
      }
    }
  } catch (err) {
    return returnVal;
  }
  return returnVal;
}

function setRecents(id: string) {
  let recents = getRecents();
  recents.push(id);
  recents = uniq(recents);
  window.localStorage.setItem('recent', JSON.stringify(recents));
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
