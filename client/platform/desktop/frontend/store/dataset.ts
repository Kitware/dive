import Vue, { ref, computed } from 'vue';
import { JsonConfig } from 'platform/desktop/constants';
import { DatasetType, SubType } from 'dive-common/apispec';
import { initializedSettings } from './settings';

const RecentsKey = 'desktop.recent';

/**
 * JsonConfigCache is a subset of JsonConfig
 * cached in localStorage for quickly listing
 * known datasets
 */
export interface JsonConfigCache {
  version: number;
  type: DatasetType | 'multi';
  id: string;
  fps: number;
  name: string;
  error?: string
  createdAt: string;
  accessedAt: string;
  originalBasePath: string;
  originalVideoFile: string;
  imageListPath: string;
  transcodedVideoFile?: string;
  subType: SubType;
  cameraNumber: number;
  calibration?: string | null;
}

/**
 * Handle migration for changes in JsonConfigCache schema
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hydrateJsonConfigCacheValue(input: any): JsonConfigCache {
  return {
    originalVideoFile: '',
    transcodedVideoFile: '',
    accessedAt: input.createdAt,
    subType: null,
    cameraNumber: 1,
    ...input,
  };
}

const datasets = ref({} as Record<string, JsonConfigCache>);

const recents = computed(() => (Object.values(datasets.value)));

function setRecents(meta: JsonConfig, accessTime?: string) {
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
    error: meta.error,
    cameraNumber: Object.keys(meta.multiCam?.cameras || {}).length,
    calibration: meta.multiCam?.calibration ?? null,
  } as JsonConfigCache);
  const values = Object.values(datasets.value);
  window.localStorage.setItem(RecentsKey, JSON.stringify(values));
}

function clearRecents() {
  datasets.value = {};
  window.localStorage.setItem(RecentsKey, JSON.stringify([]));
}

/**
 * Sync Recents with project folders on disk.
 *
 * Removes cache entries whose project dirs are missing or invalid, adds newly
 * discovered datasets, and refreshes metadata for existing ones while
 * preserving each entry's accessedAt timestamp.
 */
async function autoDiscover() {
  /* Make sure settings are ready on backend */
  await initializedSettings;
  const discovered = await window.diveDesktop.invoke<JsonConfig[]>('autodiscover-data');
  const discoveredIds = new Set(discovered.map((d) => d.id));

  Object.keys(datasets.value).forEach((id) => {
    if (!discoveredIds.has(id)) {
      removeRecents(id);
    }
  });

  discovered.forEach((d) => {
    const existing = datasets.value[d.id];
    setRecents(d, existing?.accessedAt);
  });
}

/**
 * Load recent datasets from localstorage.
 *
 * Note that the localStorage copy is just a cache and not a source of truth.
 * The real dataset JsonConfig must be loaded from disk through the
 * loadConfig() backend method.
 */
async function load() {
  try {
    const arr = window.localStorage.getItem(RecentsKey);
    if (arr) {
      const maybeArr = JSON.parse(arr);
      if (maybeArr.length) { // verify maybeArr is an array
        maybeArr.forEach((meta: JsonConfigCache) => (
          Vue.set(datasets.value, meta.id, hydrateJsonConfigCacheValue(meta))
        ));
      }
    }
  } catch (err) {
    throw new Error(`could not load meta from localstorage: ${err}`);
  }
  /* Prune missing/dead projects and pick up new ones without wiping access times */
  await autoDiscover();
}

function locateDuplicates(meta: JsonConfig) {
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
