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
import { buildMediaKeyIndex, resolveCameras } from 'dive-common/frameMetadata/resolve';

/**
 * Shared frame-metadata read composable, consumed by the Frame Info panel on both platforms.
 *
 * Platform implementations discover and read declared sidecar texts. This composable builds each
 * camera's `MediaKeyIndex` from the ordered image filenames the viewer holds
 * (`getCameraMediaNames`) and runs the shared TypeScript resolver for both web and desktop.
 *
 * There is no window, no refetch-on-scrub, and no window race (the readtime windowed-parse
 * machinery is replaced, not ported). A stale-response token discards any source-text payload
 * that lands after the dataset switched. Nothing is refetched once a dataset has been loaded
 * (an empty sources listing is negative-cached for the session).
 *
 * A module-level, single-entry cache (keyed by dataset id) holds the compact resolved payload
 * across composable instances, so closing and reopening the Frame Info panel (which destroys and
 * re-creates this composable) does not reload sidecars for a dataset already resolved this session.
 * Only the compact payload is cached; raw source text is not.
 */
export interface UseFrameMetadataOptions {
  /** Current dataset id (parent-root id for multicam). */
  datasetId: Readonly<Ref<string>>;
  /** Current playhead frame number. Drives `currentEntries`; never triggers a fetch. */
  frame: Readonly<Ref<number>>;
  /** Active camera key (`SingleCameraFrameMetadataKey` for single-camera datasets). */
  selectedCamera: Readonly<Ref<string>>;
  /**
   * The camera's ordered image filenames (frame = array index). Returns `undefined` while a
   * camera's media list is not yet loaded, in which case that camera is resolved lazily the first
   * time it is selected (multicam typically loads every camera's list up front, so this is a
   * fallback, not the common path).
   */
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

// Module-level, single-entry session cache: bounded to the most recently resolved dataset so a
// panel remount (v-if destroy/recreate) can hydrate without a refetch, without retaining state for
// every dataset ever visited. Never holds raw sidecar text.
let sessionCache: { datasetId: string; entry: FrameMetadataCacheEntry } | null = null;

/** Test-only escape hatch: clears the module-level cache so state never leaks between specs. */
export function __resetFrameMetadataSessionCache() {
  sessionCache = null;
}

export function useFrameMetadata({
  datasetId,
  frame,
  selectedCamera,
  getCameraMediaNames,
  loadFrameMetadata,
}: UseFrameMetadataOptions) {
  // Resolved payload, held compactly for the session (header + row arrays, never per-frame
  // objects). Cameras merge one at a time as their media lists become available.
  const cameras = ref<ResolvedFrameMetadata['cameras']>({});
  const sources = ref<ResolvedFrameMetadata['sources']>({});
  const columns = ref<ResolvedFrameMetadata['columns']>({});
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Stale-response token: bumped on every dataset switch. A response whose token no longer matches
  // is discarded.
  let token = 0;
  let loadedDatasetId: string | null = null;

  // Per-dataset source state. `sourceNamesByCamera` is a ref (not a plain local) so the panel can
  // reactively tell a present-but-unmatched sidecar apart from no sidecar at all (FIX 3). Raw source
  // text stays local to this composable instance and is dropped from the module cache.
  const sourceNamesByCamera = ref<Record<string, string[]>>({});
  let sourceTextsByCamera: Record<string, FrameMetadataSourceText[]> = {};
  let sourcesLoaded = false;
  const resolvedCameras = new Set<string>();

  // In-flight work counter: owns `loading` so both the eager (dataset-open) and lazy (per-camera,
  // on-selection) web resolves show a loading state, not just the initial sources fetch.
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

  // Snapshot the compact resolved state into the module cache, keyed by the dataset currently
  // loaded. Called after every successful web/desktop resolution step so the cache stays current
  // even for cameras resolved lazily well after the initial fetch.
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

  // Hydrate local state from a cached entry (panel remount for a dataset already resolved this
  // session). The raw sidecar text is never cached, so an unresolved camera may reload sources on
  // demand; one that was resolved can render from the compact cache without reloading.
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
      // Media list not loaded yet (or empty so far, e.g. Viewer's imageData starts at `[]` rather
      // than `undefined`): defer WITHOUT claiming the camera. `activeCameraMediaCount` below
      // retries reactively once the list populates.
      return;
    }
    if (requestToken !== token) {
      return;
    }
    resolvedCameras.add(camera);
    try {
      const candidates = texts.map((item): [string, string] => [item.name, item.text]);
      const index = buildMediaKeyIndex(mediaNames);
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
      // Eagerly resolve every camera whose media list is already available; the rest resolve
      // lazily on first selection. An empty listing simply resolves nothing (negative cache).
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
        // Panel remount for a dataset already resolved this session: hydrate without a refetch.
        hydrateFromCache(cached);
        if (activeCameraNeedsSourceText() && loadFrameMetadata !== undefined) {
          await runLoad(id, requestToken);
        } else if (sourcesLoaded) {
          resolveCamera(selectedCamera.value, requestToken);
        }
      } else if (loadFrameMetadata !== undefined) {
        await runLoad(id, requestToken);
      }
      return;
    }
    // Same dataset: lazily resolve the active camera if its media list has since loaded.
    if (activeCameraNeedsSourceText() && loadFrameMetadata !== undefined) {
      await runLoad(id, token);
    } else if (sourcesLoaded) {
      resolveCamera(selectedCamera.value, token);
    }
  }

  // Fetch on dataset open and on camera change (for lazy per-camera resolve). Frame is
  // deliberately not a dependency: scrubbing must never refetch.
  watch(
    [datasetId, selectedCamera],
    () => { ensure(); },
    { immediate: true },
  );

  // Reactive retry (FIX 1): Viewer.vue initializes each camera's media list to `[]`, not
  // `undefined`, and the Frame Info panel can open before media finishes loading. Track the active
  // camera's media-name count (calling `getCameraMediaNames` inside the computed so Vue tracks the
  // caller's underlying reactive source, e.g. Viewer's `imageData` ref) and re-run `ensure()` when
  // it transitions from empty to populated for a camera that is still unresolved.
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
    // Materialize the per-frame record lazily from a single row (W-12 memory posture).
    return cols.map((column, i): [string, string] => [column, row[i] ?? '']);
  });

  const currentSources = computed(() => sources.value[selectedCamera.value] ?? []);
  const hasMetadataSource = computed(() => selectedCamera.value in sources.value);

  // Whether a raw sidecar source exists for the active camera, independent of whether it resolved
  // (joined) against the media list. Lets the panel tell "a file is present but matched nothing"
  // apart from "no file at all" (FIX 3).
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
