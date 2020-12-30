import Vue from 'vue';
import { uniqBy } from 'lodash';
import Install, { ref, computed } from '@vue/composition-api';
import { JsonMeta } from 'platform/desktop/constants';

const RecentsKey = 'desktop.recent';

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

const datasets = ref({} as Record<string, JsonMeta>);

/**
 * Return reactive variable that will update
 * if properties of the dataset change
 * @param id dataset id path
 */
function getDataset(id: string) {
  return computed(() => datasets.value[id]);
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
  Vue.set(datasets.value, meta.id, meta);
  const recents = getRecents();
  recents.splice(0, 0, meta); // verify that it's a valid path
  const recentsStrings = uniqBy(recents, ({ id }) => id);
  window.localStorage.setItem(RecentsKey, JSON.stringify(recentsStrings));
}

export {
  datasets,
  getDataset,
  getRecents,
  setRecents,
  RecentsKey,
};
