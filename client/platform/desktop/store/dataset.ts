import Vue from 'vue';
import { uniqBy } from 'lodash';
import Install, { ref, computed } from '@vue/composition-api';
import { DesktopDataset, JsonMeta } from '../constants';

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
function getRecents(): JsonMeta[] {
  const arr = window.localStorage.getItem(RecentsKey);
  try {
    if (arr) {
      const maybeArr = JSON.parse(arr);
      if (maybeArr.length) {
        return maybeArr;
      }
    }
  } catch (err) {
    return [];
  }
  return [];
}

/**
 * Add ID to recent datasets
 * @param id dataset id path
 */
function setRecents(meta: JsonMeta) {
  const recents = getRecents();
  recents.splice(0, 0, meta); // verify that it's a valid path
  const recentsStrings = uniqBy(recents, ({ id }) => id);
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
  setRecents(ds.meta);
}

export {
  getDataset,
  setDataset,
  getRecents,
  RecentsKey,
};
