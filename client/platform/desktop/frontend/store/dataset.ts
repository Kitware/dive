import Vue from 'vue';
import { ipcRenderer } from 'electron';
import Install, { ref, computed } from '@vue/composition-api';
import { JsonMeta } from 'platform/desktop/constants';
import { DatasetType, SubType } from 'dive-common/apispec';
import { initializedSettings } from './settings';

const RecentsKey = 'desktop.recent';

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

/**
 * JsonMetaCache is a subset of JsonMeta
 * cached in localStorage for quickly listing
 * known datasets
 */
export interface JsonMetaCache {
  version: number;
  type: DatasetType | 'multi';
  id: string;
  fps: number;
  name: string;
  createdAt: string;
  accessedAt: string;
  originalBasePath: string;
  originalVideoFile: string;
  imageListPath: string;
  transcodedVideoFile?: string;
  subType: SubType;
  cameraNumber: number;
}

/**
 * Handle migration for changes in JsonMetaCache schema
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hydrateJsonMetaCacheValue(input: any): JsonMetaCache {
  return {
    originalVideoFile: '',
    transcodedVideoFile: '',
    accessedAt: input.createdAt,
    subType: null,
    cameraNumber: 1,
    ...input,
  };
}

const datasets = ref({} as Record<string, JsonMetaCache>);

const recents = computed(() => (Object.values(datasets.value)));

function setRecents(meta: JsonMeta, accessTime?: string) {
  Vue.set(datasets.value, meta.id, {
    version: meta.version,
    type: meta.type,
    id: meta.id,
    fps: meta.fps,
    name: meta.name,
    createdAt: meta.createdAt,
    accessedAt: accessTime || meta.createdAt,
    originalBasePath: meta.originalBasePath,
    originalVideoFile: meta.originalVideoFile,
    imageListPath: meta.imageListPath,
    transcodedVideoFile: meta.transcodedVideoFile,
    subType: meta.subType,
    cameraNumber: Object.keys(meta.multiCam || {}).length,
  } as JsonMetaCache);
  const values = Object.values(datasets.value);
  window.localStorage.setItem(RecentsKey, JSON.stringify(values));
}

async function autoDiscover() {
  datasets.value = {};
  /* Make sure settings are ready on backend */
  await initializedSettings;
  /* Nothing came from localStorage, try to populate from autodiscovery */
  const discovered: JsonMeta[] = await ipcRenderer.invoke('autodiscover-data');
  discovered.forEach((d) => setRecents(d));
}

/**
 * Load recent datasets from localstorage.
 *
 * Note that the localStorage copy is just a cache and not a source of truth.
 * The real dataset JsonMeta must be loaded from disk through the
 * loadMetadata() backend method.
 */
async function load() {
  let loaded = [];
  try {
    const arr = window.localStorage.getItem(RecentsKey);
    if (arr) {
      const maybeArr = JSON.parse(arr);
      if (maybeArr.length) { // verify maybeArr is an array
        maybeArr.forEach((meta: JsonMetaCache) => (
          Vue.set(datasets.value, meta.id, hydrateJsonMetaCacheValue(meta))
        ));
        loaded = maybeArr;
      }
    }
  } catch (err) {
    throw new Error(`could not load meta from localstorage: ${err}`);
  }
  if (loaded.length === 0) {
    autoDiscover();
  }
}

function locateDuplicates(meta: JsonMeta) {
  return recents.value.filter((candidate) => (
    candidate.originalBasePath === meta.originalBasePath
    && (
      (meta.type === 'video' && candidate.type === 'video')
        ? meta.originalVideoFile === candidate.originalVideoFile
        : true
    ) && (meta.imageListPath === candidate.imageListPath)
  ));
}

function removeRecents(datasetId: string) {
  if (datasets.value[datasetId]) {
    Vue.delete(datasets.value, datasetId);
  }
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
  autoDiscover,
  load,
  locateDuplicates,
  setRecents,
  removeRecents,
  clearRecents,
};
