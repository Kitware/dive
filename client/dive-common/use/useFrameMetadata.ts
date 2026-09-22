import {
  computed, onScopeDispose, readonly, ref, watch,
} from 'vue';
import type { Ref } from 'vue';
import { getResponseError } from 'vue-media-annotator/utils';

import type {
  FrameMetadataAttachmentText,
  FrameMetadataSourcesResponse,
} from 'dive-common/apispec';
import {
  buildFrameAlignmentIndex,
  resolveCameraAttachment,
} from 'dive-common/frameMetadata/resolve';
import type {
  FrameMetadataFrameContext,
  ResolvedCameraFrameMetadata,
} from 'dive-common/frameMetadata/resolve';

export interface UseFrameMetadataOptions {
  /** Current dataset id (parent-root id for multicam). */
  datasetId: Readonly<Ref<string>>;
  /** Current playhead frame number. Drives `currentEntries`; never triggers a fetch. */
  frame: Readonly<Ref<number>>;
  /** Active camera key (`singleCam` for single-camera datasets). */
  selectedCamera: Readonly<Ref<string>>;
  /** Ready media context for a camera, including its usable DIVE frame bound. */
  getCameraFrameContext: (camera: string) => FrameMetadataFrameContext | undefined;
  loadFrameMetadata: (datasetId: string) => Promise<FrameMetadataSourcesResponse>;
}

/**
 * What the active camera's attachment currently is. This enum is the whole taxonomy the panel
 * renders from: no consumer may re-derive a state from the payload.
 */
export type FrameMetadataAttachmentState =
  | 'none'
  | 'opaque'
  | 'unavailable'
  | 'invalid'
  | 'unmatched'
  | 'pending'
  | 'resolved';

/**
 * The session-cacheable slice of a resolved dataset. Attachment text is stripped: a remount
 * re-renders resolved rows straight from `cameras`, and a camera still waiting on its media
 * refetches the bytes it needs.
 */
interface FrameMetadataCacheEntry {
  cameras: Record<string, ResolvedCameraFrameMetadata>;
  sourceResponse: FrameMetadataSourcesResponse;
  attachmentStatesByCamera: Record<string, FrameMetadataAttachmentState>;
  sourcesLoaded: boolean;
}

// Cache the last resolved dataset so a panel remount can render without refetching attachments.
let sessionCache: { datasetId: string; entry: FrameMetadataCacheEntry } | null = null;

export function resetFrameMetadataSessionCache() {
  sessionCache = null;
}

function withoutText(response: FrameMetadataSourcesResponse): FrameMetadataSourcesResponse {
  const strip = ({ name, error }: FrameMetadataAttachmentText) => ({ name, error });
  return {
    shared: response.shared === undefined ? undefined : strip(response.shared),
    cameras: Object.fromEntries(
      Object.entries(response.cameras).map(([camera, attachment]) => [camera, strip(attachment)]),
    ),
  };
}

export function useFrameMetadata({
  datasetId,
  frame,
  selectedCamera,
  getCameraFrameContext,
  loadFrameMetadata,
}: UseFrameMetadataOptions) {
  const cameras = ref<Record<string, ResolvedCameraFrameMetadata>>({});
  const sourceResponse = ref<FrameMetadataSourcesResponse>({ cameras: {} });
  const attachmentStatesByCamera = ref<Record<string, FrameMetadataAttachmentState>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);

  // One generation counter is the whole concurrency story: it is bumped on every dataset switch,
  // and a response carrying an older token is dropped.
  let token = 0;
  let loadedDatasetId: string | null = null;
  let sourcesLoaded = false;
  // The whole attachment set loads eagerly, by design: a camera switch renders from bytes already
  // in hand. Holding the in-flight promise keeps switches during the download from starting a
  // second full load. (Per-camera lazy download is a separate, deliberately deferred change.)
  let pendingLoad: { token: number; promise: Promise<void> } | null = null;

  function setAttachmentState(camera: string, state: FrameMetadataAttachmentState) {
    attachmentStatesByCamera.value = {
      ...attachmentStatesByCamera.value,
      [camera]: state,
    };
  }

  function reset() {
    cameras.value = {};
    sourceResponse.value = { cameras: {} };
    attachmentStatesByCamera.value = {};
    error.value = null;
    loading.value = false;
    sourcesLoaded = false;
  }

  function syncSessionCache() {
    if (loadedDatasetId === null) {
      return;
    }
    sessionCache = {
      datasetId: loadedDatasetId,
      entry: {
        cameras: { ...cameras.value },
        sourceResponse: withoutText(sourceResponse.value),
        attachmentStatesByCamera: { ...attachmentStatesByCamera.value },
        sourcesLoaded,
      },
    };
  }

  function hydrateFromCache(entry: FrameMetadataCacheEntry) {
    cameras.value = { ...entry.cameras };
    sourceResponse.value = entry.sourceResponse;
    attachmentStatesByCamera.value = { ...entry.attachmentStatesByCamera };
    sourcesLoaded = entry.sourcesLoaded;
  }

  /** The one owner of camera-local-over-shared precedence. */
  function attachmentForCamera(camera: string): FrameMetadataAttachmentText | undefined {
    return sourceResponse.value.cameras[camera] ?? sourceResponse.value.shared;
  }

  // A camera is settled once its attachment has been classified against its own media. Only
  // `pending` (media not ready yet) and `none` (nothing declared yet) can still change.
  function isSettled(camera: string) {
    const state = attachmentStatesByCamera.value[camera];
    return state !== undefined && state !== 'pending' && state !== 'none';
  }

  /** Classify one camera's attachment, recording its rows when they resolve. */
  function classifyCamera(camera: string): FrameMetadataAttachmentState {
    const attachment = attachmentForCamera(camera);
    if (attachment === undefined) {
      return 'none';
    }
    if (attachment.error !== undefined) {
      return 'unavailable';
    }
    if (attachment.text === undefined) {
      return 'opaque';
    }
    const frameContext = getCameraFrameContext(camera);
    if (frameContext === undefined) {
      return 'pending';
    }
    const resolution = resolveCameraAttachment(
      attachment.text,
      buildFrameAlignmentIndex(frameContext),
      attachment.name,
    );
    if (resolution.status === 'resolved') {
      cameras.value = { ...cameras.value, [camera]: resolution.metadata };
    }
    return resolution.status;
  }

  function resolveCamera(camera: string) {
    if (isSettled(camera)) {
      return;
    }
    setAttachmentState(camera, classifyCamera(camera));
    // Every classification syncs, including `none`: a dataset that declares no attachment is the
    // case the session cache most needs to remember, or each panel remount refetches the listing.
    syncSessionCache();
  }

  async function fetchSources(id: string, requestToken: number) {
    loading.value = true;
    try {
      const response = await loadFrameMetadata(id);
      if (requestToken !== token) {
        return;
      }
      sourceResponse.value = response;
      sourcesLoaded = true;
      // Only the active camera is joined here: nothing outside can observe another camera's
      // rows, and selecting one resolves it from the text this response already carries.
      resolveCamera(selectedCamera.value);
    } catch (err) {
      if (requestToken === token) {
        error.value = getResponseError(err);
        // A failed load must not leave loadedDatasetId committed: ensure()'s same-dataset
        // short-circuit would then treat the panel as loaded and never retry, stranding it
        // on the error. Clearing it lets the next ensure() re-attempt the fetch.
        loadedDatasetId = null;
      }
    } finally {
      if (requestToken === token) {
        loading.value = false;
      }
      if (pendingLoad?.token === requestToken) {
        pendingLoad = null;
      }
    }
  }

  function loadSources(id: string, requestToken: number): Promise<void> {
    if (pendingLoad?.token === requestToken) {
      return pendingLoad.promise;
    }
    const promise = fetchSources(id, requestToken);
    pendingLoad = { token: requestToken, promise };
    return promise;
  }

  // A hydrated cache carries attachment names but no bytes, so the active camera needs a refetch
  // exactly when it is still unclassified and has no text in hand.
  function activeCameraNeedsText() {
    const attachment = attachmentForCamera(selectedCamera.value);
    return attachment !== undefined
      && attachment.text === undefined
      && !isSettled(selectedCamera.value);
  }

  async function resolveActiveCamera(id: string) {
    if (activeCameraNeedsText()) {
      await loadSources(id, token);
    } else if (sourcesLoaded) {
      resolveCamera(selectedCamera.value);
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
      const cached = sessionCache !== null && sessionCache.datasetId === id
        ? sessionCache.entry
        : null;
      if (cached === null) {
        await loadSources(id, token);
        return;
      }
      hydrateFromCache(cached);
    }
    await resolveActiveCamera(id);
  }

  watch(
    [datasetId, selectedCamera],
    () => { ensure(); },
    { immediate: true },
  );

  // SidebarContext mounts the panel behind a v-if, so an in-flight load can outlive the
  // composable. Retiring the token on teardown makes that response stale, which is the same
  // mechanism a dataset switch uses -- a destroyed panel must not write the shared session cache.
  onScopeDispose(() => { token += 1; });

  const activeCameraFrameContextSignature = computed(() => {
    const context = getCameraFrameContext(selectedCamera.value);
    if (context === undefined) {
      return undefined;
    }
    return context.mediaType === 'video'
      ? `video:${context.frameCount}`
      : `image-sequence:${context.mediaNames.length}`;
  });
  // A camera's media list (or video frame bound) can arrive after its attachment: retry the
  // camera parked in `pending` as soon as its frame context exists.
  watch(activeCameraFrameContextSignature, (signature, previous) => {
    if (signature !== undefined && previous === undefined) {
      ensure();
    }
  });

  const currentEntries = computed<[string, string][]>(() => {
    const resolved = cameras.value[selectedCamera.value];
    const row = resolved?.records[frame.value];
    if (resolved === undefined || row === undefined) {
      return [];
    }
    return resolved.columns.map((column, i): [string, string] => [column, row[i] ?? '']);
  });

  /** Attachment declared for the active camera, whatever state it is in. */
  const attachmentName = computed(() => attachmentForCamera(selectedCamera.value)?.name);
  /**
   * Why the backend could not hand over the attachment's bytes; set exactly when the state is
   * `unavailable`. The state alone cannot tell an unreadable attachment from several competing
   * reserved-name ones, so the reason the backend authored is what the panel must show.
   */
  const attachmentError = computed(() => attachmentForCamera(selectedCamera.value)?.error);
  /** Attachment the displayed rows came from; undefined until the rows resolve. */
  const resolvedSourceName = computed(() => cameras.value[selectedCamera.value]?.sourceName);
  const attachmentState = computed<FrameMetadataAttachmentState>(() => (
    attachmentStatesByCamera.value[selectedCamera.value]
    ?? (attachmentName.value === undefined ? 'none' : 'pending')
  ));

  return {
    currentEntries,
    attachmentName,
    attachmentError,
    resolvedSourceName,
    attachmentState,
    loading: readonly(loading),
    error: readonly(error),
  };
}
