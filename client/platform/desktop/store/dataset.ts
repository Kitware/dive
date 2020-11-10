import path from 'path';

import Vue from 'vue';
import { uniq } from 'lodash';
import Install, { ref, computed } from '@vue/composition-api';
import { DesktopDataset } from '../constants';

const RecentsKey = 'desktop.recent';

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

const dsmap = ref({} as Record<string, DesktopDataset>);

/**
 * Return reactive variable that will update
 * if properties of the dataset change
 * @param id dataset id path
 */
function getDataset(id: string) {
  return computed(() => dsmap.value[id]);
}

/**
 * Load recent datasets from localstorage
 */
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

/**
 * Add ID to recent datasets
 * @param id dataset id path
 */
function setRecents(id: string) {
  const recents = getRecents();
  recents.splice(0, 0, path.parse(id)); // verify that it's a valid path
  let recentsStrings = recents.map((r) => path.join(r.dir, r.base));
  recentsStrings = uniq(recentsStrings);
  window.localStorage.setItem(RecentsKey, JSON.stringify(recentsStrings));
}

/**
 * Set properties of in-memory dataset,
 * and persist ID to recents
 * @param id dataset id path
 * @param ds properties
 */
function setDataset(id: string, ds: DesktopDataset) {
  Vue.set(dsmap.value, id, ds);
  setRecents(id);
}

export {
  getDataset,
  setDataset,
  getRecents,
};
