import {
  computed, readonly, ref, watch,
} from 'vue';
import type { Ref } from 'vue';
import { getResponseError } from 'vue-media-annotator/utils';

import type {
  FrameMetadataSourceItem,
  FrameMetadataSourcesResponse,
  ResolvedFrameMetadata,
} from 'dive-common/apispec';
import { buildMediaKeyIndex, resolveCameras } from 'dive-common/frameMetadata/resolve';

/**
 * Shared frame-metadata read composable, consumed by the Frame Info panel on both platforms.
 *
 * The only platform difference is who runs the shared TypeScript resolver:
 *  - WEB  (`loadFrameMetadataSources` present): the browser lists sidecar items per camera,
 *    downloads their bytes via `downloadItemText`, builds each camera's `MediaKeyIndex` from the
 *    ordered image filenames the viewer holds (`getCameraMediaNames`), and runs `resolveCameras`.
 *  - DESKTOP (`loadFrameMetadata` present): the backend already resolved; the payload is held as-is.
 *
 * There is no window, no refetch-on-scrub, and no window race (the readtime windowed-parse
 * machinery is replaced, not ported). A stale-response token discards any download/resolve or
 * desktop payload that lands after the dataset switched. Nothing is refetched once a dataset has
 * been resolved (an empty sources listing is negative-cached for the session).
 *
 * A module-level, single-entry cache (keyed by dataset id) holds the compact resolved payload
 * across composable instances, so closing and reopening the Frame Info panel (which destroys and
 * re-creates this composable) does not re-download sidecars for a dataset already visited this
 * session. Only the compact payload is cached; raw downloaded text is not (see `resolveWebCamera`).
 */
export interface UseFrameMetadataOptions {
  /** Current dataset id (parent-root id for multicam). */
  datasetId: Readonly<Ref<string>>;
  /** Current playhead frame number. Drives `currentEntries`; never triggers a fetch. */
  frame: Readonly<Ref<number>>;
  /** Active camera key (`SingleCameraFrameMetadataKey` for single-camera datasets). */
  selectedCamera: Readonly<Ref<string>>;
  /** Web: list sidecar items per camera (server sources endpoint, no parsing). */
  loadFrameMetadataSources?: (datasetId: string) => Promise<FrameMetadataSourcesResponse>;
  /** Web: download one sidecar item's raw text by item id. */
  downloadItemText?: (itemId: string) => Promise<string>;
  /**
   * Web: the camera's ordered image filenames (frame = array index). Returns `undefined` while a
   * camera's media list is not yet loaded, in which case that camera is resolved lazily the first
   * time it is selected (multicam typically loads every camera's list up front, so this is a
   * fallback, not the common path).
   */
  getCameraMediaNames?: (camera: string) => string[] | undefined;
  /** Desktop: the backend-resolved per-camera payload. */
  loadFrameMetadata?: (datasetId: string) => Promise<ResolvedFrameMetadata>;
}

/** The compact, session-cacheable slice of a resolved dataset's state (no raw sidecar text). */
interface FrameMetadataCacheEntry {
  cameras: ResolvedFrameMetadata['cameras'];
  sources: ResolvedFrameMetadata['sources'];
  columns: ResolvedFrameMetadata['columns'];
  sidecarsByCamera: Record<string, FrameMetadataSourceItem[]>;
  resolvedCameras: Set<string>;
  sourcesFetched: boolean;
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
  loadFrameMetadataSources,
  downloadItemText,
  getCameraMediaNames,
  loadFrameMetadata,
}: UseFrameMetadataOptions) {
  // Resolved payload, held compactly for the session (header + row arrays, never per-frame
  // objects). Web merges one camera at a time; desktop sets it wholesale.
  const cameras = ref<ResolvedFrameMetadata['cameras']>({});
  const sources = ref<ResolvedFrameMetadata['sources']>({});
  const columns = ref<ResolvedFrameMetadata['columns']>({});
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Stale-response token: bumped on every dataset switch. A response whose token no longer matches
  // is discarded.
  let token = 0;
  let loadedDatasetId: string | null = null;

  // Web per-dataset session state. `sidecarsByCamera` is a ref (not a plain local) so the panel can
  // reactively tell a present-but-unmatched sidecar apart from no sidecar at all (FIX 3).
  const sidecarsByCamera = ref<Record<string, FrameMetadataSourceItem[]>>({});
  let sourcesFetched = false;
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
    sidecarsByCamera.value = {};
    sourcesFetched = false;
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
        sidecarsByCamera: { ...sidecarsByCamera.value },
        resolvedCameras: new Set(resolvedCameras),
        sourcesFetched,
      },
    };
  }

  // Hydrate local state from a cached entry (panel remount for a dataset already resolved this
  // session). The raw sidecar text is never cached, so a camera that was not yet resolved when the
  // entry was written still resolves lazily/normally; one that was resolved is not re-downloaded.
  function hydrateFromCache(entry: FrameMetadataCacheEntry) {
    cameras.value = { ...entry.cameras };
    sources.value = { ...entry.sources };
    columns.value = { ...entry.columns };
    sidecarsByCamera.value = { ...entry.sidecarsByCamera };
    resolvedCameras.clear();
    entry.resolvedCameras.forEach((camera) => resolvedCameras.add(camera));
    sourcesFetched = entry.sourcesFetched;
  }

  async function resolveWebCamera(
    camera: string,
    requestToken: number,
    passTexts: Map<string, Promise<string>>,
  ) {
    if (downloadItemText === undefined || resolvedCameras.has(camera)) {
      return;
    }
    const items = sidecarsByCamera.value[camera];
    if (items === undefined || items.length === 0) {
      return;
    }
    const mediaNames = getCameraMediaNames?.(camera);
    if (mediaNames === undefined || mediaNames.length === 0) {
      // Media list not loaded yet (or empty so far, e.g. Viewer's imageData starts at `[]` rather
      // than `undefined`): defer WITHOUT claiming the camera. `activeCameraMediaCount` below
      // retries reactively once the list populates.
      return;
    }
    // Claim the camera before awaiting so concurrent ensure() passes never double-download.
    resolvedCameras.add(camera);
    beginWork();
    try {
      const candidates = await Promise.all(
        items.map(async (item): Promise<[string, string]> => {
          // Dedupe concurrent downloads within a resolve pass: a sidecar the server lists for
          // several cameras (a shared parent/dataset-root file) is fetched once, not per camera.
          let pending = passTexts.get(item.itemId);
          if (pending === undefined) {
            pending = downloadItemText(item.itemId);
            passTexts.set(item.itemId, pending);
          }
          return [item.name, await pending];
        }),
      );
      if (requestToken !== token) {
        return;
      }
      const index = buildMediaKeyIndex(mediaNames);
      mergeResolved(resolveCameras({ [camera]: candidates }, { [camera]: index }));
      syncSessionCache();
    } catch (err) {
      resolvedCameras.delete(camera);
      if (requestToken === token) {
        error.value = getResponseError(err);
      }
    } finally {
      endWork(requestToken);
    }
  }

  async function runWeb(id: string, requestToken: number) {
    if (loadFrameMetadataSources === undefined) {
      return;
    }
    beginWork();
    try {
      const response = await loadFrameMetadataSources(id);
      if (requestToken !== token) {
        return;
      }
      sidecarsByCamera.value = response.cameras ?? {};
      sourcesFetched = true;
      // Eagerly resolve every camera whose media list is already available; the rest resolve
      // lazily on first selection. An empty listing simply resolves nothing (negative cache).
      // One text cache per pass: shared sidecars download once across cameras, and the raw text
      // (a multi-MB nav log under no-cap) is released when this map goes out of scope — only the
      // compact resolved payload is retained (W-12 posture).
      const passTexts = new Map<string, Promise<string>>();
      await Promise.all(
        Object.keys(sidecarsByCamera.value).map(
          (camera) => resolveWebCamera(camera, requestToken, passTexts),
        ),
      );
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

  async function runDesktop(id: string, requestToken: number) {
    if (loadFrameMetadata === undefined) {
      return;
    }
    beginWork();
    try {
      const payload = await loadFrameMetadata(id);
      if (requestToken !== token) {
        return;
      }
      cameras.value = payload.cameras ?? {};
      sources.value = payload.sources ?? {};
      columns.value = payload.columns ?? {};
      syncSessionCache();
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
        if (sourcesFetched) {
          await resolveWebCamera(selectedCamera.value, requestToken, new Map());
        }
      } else if (loadFrameMetadataSources !== undefined) {
        await runWeb(id, requestToken);
      } else if (loadFrameMetadata !== undefined) {
        await runDesktop(id, requestToken);
      }
      return;
    }
    // Same dataset: lazily resolve the active web camera if its media list has since loaded.
    if (sourcesFetched) {
      await resolveWebCamera(selectedCamera.value, token, new Map());
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
      && sourcesFetched
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

  // Whether a raw sidecar ITEM exists for the active camera, independent of whether it resolved
  // (joined) against the media list. Lets the panel tell "a file is present but matched nothing"
  // apart from "no file at all" (FIX 3). Desktop has no raw listing, so these are always false/[].
  const hasSidecarItems = computed(() => (
    (sidecarsByCamera.value[selectedCamera.value]?.length ?? 0) > 0
  ));
  const sidecarSourceNames = computed(() => (
    sidecarsByCamera.value[selectedCamera.value]?.map((item) => item.name) ?? []
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
