import Vue from 'vue';
import Install, { ref, computed } from '@vue/composition-api';
import { JsonMeta } from 'platform/desktop/constants';

const RecentsKey = 'desktop.recent';

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

const datasets = ref({} as Record<string, JsonMeta>);

const recents = computed(() => {
  const list = Object.values(datasets.value)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, 20);
  return list;
});

/**
 * Load recent datasets from localstorage
 */
function load(): JsonMeta[] {
  try {
    const arr = window.localStorage.getItem(RecentsKey);
    if (arr) {
      const maybeArr = JSON.parse(arr);
      if (maybeArr.length) {
        maybeArr.forEach((meta: JsonMeta) => (
          Vue.set(datasets.value, meta.id, meta)
        ));
        return maybeArr;
      }
    }
    return [];
  } catch (err) {
    throw new Error(`could not load meta from localstorage: ${err}`);
  }
}

/**
 * Add ID to recent datasets
 * @param id dataset id path
 */
function setRecents(meta: JsonMeta) {
  Vue.set(datasets.value, meta.id, meta);
  const values = Object.values(datasets.value);
  window.localStorage.setItem(RecentsKey, JSON.stringify(values));
}

function clearRecents() {
  datasets.value = {};
  window.localStorage.setItem(RecentsKey, JSON.stringify([]));
}

export {
  datasets,
  recents,
  load,
  setRecents,
  clearRecents,
};
