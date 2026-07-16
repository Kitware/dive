import {
  computed, readonly, ref, watch,
} from 'vue';
import type { Ref } from 'vue';
import { getResponseError } from 'vue-media-annotator/utils';

import type {
  FrameMetadataSourceText,
  FrameMetadataSourcesResponse,
  ResolvedFrameMetadata,
} from 'dive-common/apispec';
import { buildFrameAlignmentIndex, resolveCameras } from 'dive-common/frameMetadata/resolve';

export interface UseFrameMetadataOptions {
  /** Current dataset id (parent-root id for multicam). */
  datasetId: Readonly<Ref<string>>;
  /** Current playhead frame number. Drives `currentEntries`; never triggers a fetch. */
  frame: Readonly<Ref<number>>;
  /** Active camera key (`singleCam` for single-camera datasets). */
  selectedCamera: Readonly<Ref<string>>;
  /** Ordered image filenames for a camera, where frame number is the array index. */
  getCameraMediaNames?: (camera: string) => string[] | undefined;
  loadFrameMetadata?: (datasetId: string) => Promise<FrameMetadataSourcesResponse>;
}

/** The compact, session-cacheable slice of a resolved dataset's state (no raw sidecar text). */
interface FrameMetadataCacheEntry {
  cameras: ResolvedFrameMetadata['cameras'];
  sources: ResolvedFrameMetadata['sources'];
  columns: ResolvedFrameMetadata['columns'];
  sourceNamesByCamera: Record<string, string[]>;
  resolvedCameras: Set<string>;
  sourcesLoaded: boolean;
}

// Cache the last resolved dataset so a panel remount can render without refetching sidecars.
let sessionCache: { datasetId: string; entry: FrameMetadataCacheEntry } | null = null;

export function __resetFrameMetadataSessionCache() {
  sessionCache = null;
}

// Bumped when a sidecar is added or removed (e.g. explicit frame metadata import) so live
// composable instances drop their state and refetch instead of serving stale sources.
const invalidationCounter = ref(0);

export function invalidateFrameMetadata() {
  sessionCache = null;
  invalidationCounter.value += 1;
}

export function useFrameMetadata({
  datasetId,
  frame,
  selectedCamera,
  getCameraMediaNames,
  loadFrameMetadata,
}: UseFrameMetadataOptions) {
  const cameras = ref<ResolvedFrameMetadata['cameras']>({});
  const sources = ref<ResolvedFrameMetadata['sources']>({});
  const columns = ref<ResolvedFrameMetadata['columns']>({});
  const loading = ref(false);
  const error = ref<string | null>(null);

  let token = 0;
  let loadedDatasetId: string | null = null;

  const sourceNamesByCamera = ref<Record<string, string[]>>({});
  let sourceTextsByCamera: Record<string, FrameMetadataSourceText[]> = {};
  let sourcesLoaded = false;
  const resolvedCameras = new Set<string>();

  let inFlight = 0;
  function beginWork() {
    inFlight += 1;
    loading.value = true;
  }
  function endWork(reqToken: number) {
    inFlight = Math.max(0, inFlight - 1);
    if (inFlight === 0 && reqToken === token) {
      loading.value = false;
    }
  }

  function reset() {
    cameras.value = {};
    sources.value = {};
    columns.value = {};
    error.value = null;
    loading.value = false;
    inFlight = 0;
    sourceNamesByCamera.value = {};
    sourceTextsByCamera = {};
    sourcesLoaded = false;
    resolvedCameras.clear();
  }

  function mergeResolved(result: ResolvedFrameMetadata) {
    cameras.value = { ...cameras.value, ...result.cameras };
    sources.value = { ...sources.value, ...result.sources };
    columns.value = { ...columns.value, ...result.columns };
  }

  function syncSessionCache() {
    if (loadedDatasetId === null) {
      return;
    }
    sessionCache = {
      datasetId: loadedDatasetId,
      entry: {
        cameras: { ...cameras.value },
        sources: { ...sources.value },
        columns: { ...columns.value },
        sourceNamesByCamera: { ...sourceNamesByCamera.value },
        resolvedCameras: new Set(resolvedCameras),
        sourcesLoaded,
      },
    };
  }

  function hydrateFromCache(entry: FrameMetadataCacheEntry) {
    cameras.value = { ...entry.cameras };
    sources.value = { ...entry.sources };
    columns.value = { ...entry.columns };
    sourceNamesByCamera.value = { ...entry.sourceNamesByCamera };
    resolvedCameras.clear();
    entry.resolvedCameras.forEach((camera) => resolvedCameras.add(camera));
    sourcesLoaded = entry.sourcesLoaded;
  }

  function activeCameraNeedsSourceText() {
    return (
      (sourceNamesByCamera.value[selectedCamera.value]?.length ?? 0) > 0
      && !resolvedCameras.has(selectedCamera.value)
      && sourceTextsByCamera[selectedCamera.value] === undefined
    );
  }

  function resolveCamera(
    camera: string,
    requestToken: number,
  ) {
    if (resolvedCameras.has(camera)) {
      return;
    }
    const texts = sourceTextsByCamera[camera];
    if (texts === undefined || texts.length === 0) {
      return;
    }
    const mediaNames = getCameraMediaNames?.(camera);
    if (mediaNames === undefined || mediaNames.length === 0) {
      return;
    }
    if (requestToken !== token) {
      return;
    }
    resolvedCameras.add(camera);
    try {
      const candidates = texts.map((item): [string, string] => [item.name, item.text]);
      const index = buildFrameAlignmentIndex(mediaNames);
      mergeResolved(resolveCameras({ [camera]: candidates }, { [camera]: index }));
      syncSessionCache();
    } catch (err) {
      resolvedCameras.delete(camera);
      if (requestToken === token) {
        error.value = getResponseError(err);
      }
    }
  }

  async function runLoad(id: string, requestToken: number) {
    if (loadFrameMetadata === undefined) {
      return;
    }
    beginWork();
    try {
      const response = await loadFrameMetadata(id);
      if (requestToken !== token) {
        return;
      }
      sourceTextsByCamera = response.cameras ?? {};
      sourceNamesByCamera.value = Object.fromEntries(
        Object.entries(sourceTextsByCamera).map(([camera, items]) => (
          [camera, items.map((item) => item.name)]
        )),
      );
      sourcesLoaded = true;
      Object.keys(sourceTextsByCamera).forEach((camera) => resolveCamera(camera, requestToken));
      if (requestToken === token) {
        syncSessionCache();
      }
    } catch (err) {
      if (requestToken === token) {
        error.value = getResponseError(err);
      }
    } finally {
      endWork(requestToken);
    }
  }

  async function resolveActiveCamera(id: string, requestToken: number) {
    if (activeCameraNeedsSourceText() && loadFrameMetadata !== undefined) {
      await runLoad(id, requestToken);
    } else if (sourcesLoaded) {
      resolveCamera(selectedCamera.value, requestToken);
    }
  }

  async function ensure() {
    const id = datasetId.value;
    if (!id) {
      if (loadedDatasetId !== null) {
        token += 1;
        loadedDatasetId = null;
        reset();
      }
      return;
    }
    if (id !== loadedDatasetId) {
      token += 1;
      loadedDatasetId = id;
      reset();
      const requestToken = token;
      const cached = sessionCache !== null && sessionCache.datasetId === id
        ? sessionCache.entry
        : null;
      if (cached) {
        hydrateFromCache(cached);
        await resolveActiveCamera(id, requestToken);
      } else if (loadFrameMetadata !== undefined) {
        await runLoad(id, requestToken);
      }
      return;
    }
    await resolveActiveCamera(id, token);
  }

  watch(
    [datasetId, selectedCamera],
    () => { ensure(); },
    { immediate: true },
  );

  watch(invalidationCounter, async () => {
    const id = datasetId.value;
    if (!id) {
      return;
    }
    token += 1;
    loadedDatasetId = id;
    reset();
    await runLoad(id, token);
  });

  // The viewer can expose an empty media list before filenames finish loading.
  const activeCameraMediaCount = computed(() => (
    getCameraMediaNames ? (getCameraMediaNames(selectedCamera.value)?.length ?? 0) : 0
  ));
  watch(activeCameraMediaCount, (count, prev) => {
    if (
      count > 0
      && (prev ?? 0) === 0
      && sourcesLoaded
      && datasetId.value === loadedDatasetId
      && !resolvedCameras.has(selectedCamera.value)
    ) {
      ensure();
    }
  });

  const currentEntries = computed<[string, string][]>(() => {
    const camera = selectedCamera.value;
    const cols = columns.value[camera];
    const row = cameras.value[camera]?.[frame.value];
    if (cols === undefined || row === undefined) {
      return [];
    }
    return cols.map((column, i): [string, string] => [column, row[i] ?? '']);
  });

  const currentSources = computed(() => sources.value[selectedCamera.value] ?? []);
  const hasMetadataSource = computed(() => selectedCamera.value in sources.value);

  const hasSidecarItems = computed(() => (
    (sourceNamesByCamera.value[selectedCamera.value]?.length ?? 0) > 0
  ));
  const sidecarSourceNames = computed(() => (
    sourceNamesByCamera.value[selectedCamera.value] ?? []
  ));

  return {
    currentEntries,
    currentSources,
    hasMetadataSource,
    hasSidecarItems,
    sidecarSourceNames,
    loading: readonly(loading),
    error: readonly(error),
    ensure,
  };
}

export type UseFrameMetadata = ReturnType<typeof useFrameMetadata>;
