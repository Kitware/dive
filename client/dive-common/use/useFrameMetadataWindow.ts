import {
  computed, readonly, ref, watch,
} from 'vue';
import type { Ref } from 'vue';

import type {
  FrameMetadataCameraMap,
  FrameMetadataResponse,
  FrameMetadataValues,
} from '../apispec';

export const DEFAULT_FRAME_METADATA_WINDOW_SIZE = 101;

export interface FrameMetadataWindowRange {
  startFrame: number;
  endFrame: number;
}

export type LoadFrameMetadata = (
  datasetId: string,
  startFrame: number,
  endFrame: number
) => Promise<FrameMetadataResponse>;

interface UseFrameMetadataWindowOptions {
  datasetId: Readonly<Ref<string>>;
  frame: Readonly<Ref<number>>;
  selectedCamera: Readonly<Ref<string>>;
  loadFrameMetadata?: LoadFrameMetadata;
  windowSize?: number;
  maxFrame?: Readonly<Ref<number>>;
}

function finiteFloor(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeWindowSize(windowSize: number) {
  return Math.max(1, finiteFloor(windowSize, DEFAULT_FRAME_METADATA_WINDOW_SIZE));
}

function normalizeMaxFrame(maxFrame: number | undefined) {
  if (maxFrame === undefined || !Number.isFinite(maxFrame)) {
    return undefined;
  }
  return Math.max(0, Math.floor(maxFrame));
}

function normalizeFrame(frame: number, maxFrame?: number) {
  const safeFrame = Math.max(0, finiteFloor(frame, 0));
  if (maxFrame === undefined) {
    return safeFrame;
  }
  return Math.min(safeFrame, maxFrame);
}

function containsFrame(range: FrameMetadataWindowRange | null, frame: number) {
  return !!range && range.startFrame <= frame && frame <= range.endFrame;
}

function errorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function frameMetadataWindowForFrame(
  frame: number,
  windowSize = DEFAULT_FRAME_METADATA_WINDOW_SIZE,
  maxFrame: number | undefined = undefined,
): FrameMetadataWindowRange {
  const size = normalizeWindowSize(windowSize);
  const safeMaxFrame = normalizeMaxFrame(maxFrame);
  const targetFrame = normalizeFrame(frame, safeMaxFrame);
  const framesBefore = Math.floor((size - 1) / 2);

  let startFrame = Math.max(0, targetFrame - framesBefore);
  let endFrame = startFrame + size - 1;

  if (safeMaxFrame !== undefined && endFrame > safeMaxFrame) {
    endFrame = safeMaxFrame;
    startFrame = Math.max(0, endFrame - size + 1);
  }

  return { startFrame, endFrame };
}

export function useFrameMetadataWindow({
  datasetId,
  frame,
  selectedCamera,
  loadFrameMetadata,
  windowSize = DEFAULT_FRAME_METADATA_WINDOW_SIZE,
  maxFrame,
}: UseFrameMetadataWindowOptions) {
  const cameras = ref<FrameMetadataCameraMap>({});
  const windowRange = ref<FrameMetadataWindowRange | null>(null);
  const loadedDatasetId = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let requestToken = 0;
  let pendingRequest: Promise<void> | null = null;
  let pendingDatasetId: string | null = null;
  let pendingRange: FrameMetadataWindowRange | null = null;

  function clearCache() {
    cameras.value = {};
    windowRange.value = null;
    loadedDatasetId.value = null;
  }

  function clearPendingRequest() {
    requestToken += 1;
    pendingRequest = null;
    pendingDatasetId = null;
    pendingRange = null;
    loading.value = false;
    error.value = null;
  }

  async function fetchWindow(targetFrame: number) {
    if (!loadFrameMetadata || !datasetId.value) {
      clearPendingRequest();
      clearCache();
      return undefined;
    }

    const requestDatasetId = datasetId.value;
    const requestRange = frameMetadataWindowForFrame(
      targetFrame,
      windowSize,
      maxFrame?.value,
    );

    if (loadedDatasetId.value !== requestDatasetId) {
      clearCache();
    }

    const token = requestToken + 1;
    requestToken = token;
    pendingDatasetId = requestDatasetId;
    pendingRange = requestRange;
    loading.value = true;
    error.value = null;

    pendingRequest = (async () => {
      try {
        const response = await loadFrameMetadata(
          requestDatasetId,
          requestRange.startFrame,
          requestRange.endFrame,
        );

        if (token === requestToken) {
          cameras.value = response.cameras;
          windowRange.value = requestRange;
          loadedDatasetId.value = requestDatasetId;
        }
      } catch (err) {
        if (token === requestToken) {
          error.value = errorMessage(err);
        }
      } finally {
        if (token === requestToken) {
          loading.value = false;
          pendingRequest = null;
          pendingDatasetId = null;
          pendingRange = null;
        }
      }
    })();

    return pendingRequest;
  }

  async function ensureFrameLoaded() {
    const targetFrame = normalizeFrame(frame.value, normalizeMaxFrame(maxFrame?.value));
    if (
      loadedDatasetId.value === datasetId.value
      && containsFrame(windowRange.value, targetFrame)
    ) {
      return undefined;
    }

    if (
      pendingRequest
      && pendingDatasetId === datasetId.value
      && containsFrame(pendingRange, targetFrame)
    ) {
      return pendingRequest;
    }

    return fetchWindow(targetFrame);
  }

  const currentFrameKey = computed(() => String(
    normalizeFrame(frame.value, normalizeMaxFrame(maxFrame?.value)),
  ));
  const currentRows = computed<FrameMetadataValues | null>(() => (
    cameras.value[selectedCamera.value]?.[currentFrameKey.value] ?? null
  ));
  const currentEntries = computed(() => (
    currentRows.value ? Object.entries(currentRows.value) : []
  ));
  const hasMetadataSource = computed(() => Object.keys(cameras.value).length > 0);
  const unsupported = computed(() => loadFrameMetadata === undefined);

  watch(
    () => [datasetId.value, currentFrameKey.value, maxFrame?.value],
    () => {
      ensureFrameLoaded();
    },
    { immediate: true },
  );

  return {
    cameras: readonly(cameras),
    currentEntries,
    currentRows,
    ensureFrameLoaded,
    error: readonly(error),
    hasMetadataSource,
    loading: readonly(loading),
    unsupported,
    windowRange: readonly(windowRange),
  };
}

export type UseFrameMetadataWindow = ReturnType<typeof useFrameMetadataWindow>;
