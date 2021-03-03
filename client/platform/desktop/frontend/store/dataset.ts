import Vue from 'vue';
import Install, { ref, computed } from '@vue/composition-api';
import { JsonMeta } from 'platform/desktop/constants';
import { DatasetType } from 'dive-common/apispec';

const RecentsKey = 'desktop.recent';

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

/**
 * JsonMetaCache is a subset of JsonMeta
 * cached in localStorage for quickly listing
 * known datasets
 */
interface JsonMetaCache {
  version: number;
  type: DatasetType;
  id: string;
  fps: number;
  name: string;
  createdAt: string;
  originalBasePath: string;
}

const datasets = ref({} as Record<string, JsonMetaCache>);

const recents = computed(() => {
  const list = Object.values(datasets.value)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return list;
});

/**
 * Load recent datasets from localstorage.
 *
 * Note that the localStorage copy is just a cache and not a source of truth.
 * The real dataset JsonMeta must be loaded from disk through the
 * loadMetadata() backend method.
 */
function load(): JsonMetaCache[] {
  try {
    const arr = window.localStorage.getItem(RecentsKey);
    if (arr) {
      const maybeArr = JSON.parse(arr);
      if (maybeArr.length) {
        maybeArr.forEach((meta: JsonMetaCache) => (
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
  Vue.set(datasets.value, meta.id, {
    version: meta.version,
    type: meta.type,
    id: meta.id,
    fps: meta.fps,
    name: meta.name,
    createdAt: meta.createdAt,
    originalBasePath: meta.originalBasePath,
  });
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
