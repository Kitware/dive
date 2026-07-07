/**
 * Video search / IQR session state shared between ViewerLoader (which owns
 * dataset media details) and the VideoSearchContext side panel.
 *
 * Created and provided by ViewerLoader; injected by the panel.
 *
 * All indexed datasets share one search database, so every query searches
 * every indexed dataset in a single IQR session. Each result's stream_id
 * maps back to its source dataset via the index membership metadata.
 */
import { reactive, provide, inject } from 'vue';
import type {
  VideoSearchIndexStatus, VideoSearchIndexMethod, VideoSearchIndexInfo,
  VideoSearchResult, VideoSearchQueryResponse,
} from 'dive-common/apispec';
import {
  videoSearchInstalled, videoSearchIndexStatus, videoSearchBuildIndex,
  videoSearchRemoveIndex, videoSearchOpenIndex,
  videoSearchFormulate, videoSearchQuery, videoSearchRefine,
  videoSearchExportModel, videoSearchClose, videoSearchExtractFrame,
  loadMetadata,
} from 'platform/desktop/frontend/api';

export const VideoSearchInjectKey = 'DesktopVideoSearch';

export type Adjudication = 'positive' | 'negative';

export interface VideoSearchMediaInfo {
  type: string; // 'image-sequence' | 'video'
  fps: number;
  getImagePath: (frameNum: number) => string;
}

interface VideoSearchState {
  installed: boolean | null;
  status: VideoSearchIndexStatus | null;
  sessionOpen: boolean;
  /** stream identifier -> source dataset info for the open index. */
  streams: Record<string, VideoSearchIndexInfo>;
  /** Human-readable description of the operation in flight, or null. */
  busy: string | null;
  error: string | null;
  results: VideoSearchResult[];
  /** Keyed by result ref ("<session>:<instance_id>"). */
  adjudications: Record<string, Adjudication | undefined>;
  /** Completed refinement iterations for the active query. */
  iteration: number;
  modelAvailable: boolean;
}

/** Renderer-safe path join (node 'path' is unavailable here). */
function isAbsolutePath(p: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(p);
}
function joinPath(base: string, file: string): string {
  if (!base) return file;
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${sep}${file}`;
}

export function createVideoSearch(
  datasetId: string,
  getMediaInfo: () => VideoSearchMediaInfo | null,
) {
  const state = reactive<VideoSearchState>({
    installed: null,
    status: null,
    sessionOpen: false,
    streams: {},
    busy: null,
    error: null,
    results: [],
    adjudications: {},
    iteration: 0,
    modelAvailable: false,
  });

  /** Media info per dataset for cross-dataset result display. */
  const mediaInfoCache: Record<string, VideoSearchMediaInfo | null> = {};

  async function getMediaInfoFor(dsId: string): Promise<VideoSearchMediaInfo | null> {
    if (dsId === datasetId) {
      return getMediaInfo();
    }
    if (!(dsId in mediaInfoCache)) {
      try {
        const meta = await loadMetadata(dsId);
        const {
          originalBasePath, originalImageFiles, type, originalVideoFile, fps,
        } = meta;
        mediaInfoCache[dsId] = {
          type,
          fps,
          getImagePath: (frameNum: number): string => {
            if (type === 'video') {
              return joinPath(originalBasePath, originalVideoFile || '');
            }
            const imagePath = originalImageFiles?.[frameNum];
            if (!imagePath) return '';
            return isAbsolutePath(imagePath)
              ? imagePath : joinPath(originalBasePath, imagePath);
          },
        };
      } catch {
        mediaInfoCache[dsId] = null;
      }
    }
    return mediaInfoCache[dsId];
  }

  async function refreshStatus() {
    try {
      if (state.installed === null) {
        state.installed = await videoSearchInstalled();
      }
      if (state.installed) {
        state.status = await videoSearchIndexStatus(datasetId);
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Run an operation with busy/error bookkeeping. */
  async function guarded<T>(label: string, op: () => Promise<T>): Promise<T | undefined> {
    if (state.busy) {
      return undefined;
    }
    state.busy = label;
    state.error = null;
    try {
      return await op();
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      return undefined;
    } finally {
      state.busy = null;
    }
  }

  function buildIndex(method: VideoSearchIndexMethod) {
    // Runs through the GPU job queue; completion observed via the jobs store.
    videoSearchBuildIndex(datasetId, method);
  }

  /** Remove this dataset from the shared search index. */
  async function removeFromIndex() {
    await guarded('Removing from index...', async () => {
      await videoSearchRemoveIndex(datasetId);
      state.sessionOpen = false;
      state.streams = {};
      resetQueryState();
    });
    await refreshStatus();
  }

  function resetQueryState() {
    state.results = [];
    state.adjudications = {};
    state.iteration = 0;
    state.modelAvailable = false;
  }

  /**
   * Open the shared search index (covering every indexed dataset). The
   * backend is a no-op when it is already open.
   */
  async function ensureSession() {
    const { streams } = await videoSearchOpenIndex();
    const map: Record<string, VideoSearchIndexInfo> = {};
    streams.forEach((info) => { map[info.streamName] = info; });
    state.streams = map;
    state.sessionOpen = true;
  }

  /** The dataset a result belongs to (via its stream identifier). */
  function resultDatasetId(result: VideoSearchResult): string | null {
    return state.streams[result.stream_id]?.datasetId ?? null;
  }

  /** Display name of a result's dataset, or null when it is this dataset. */
  function resultDatasetName(result: VideoSearchResult): string | null {
    const info = state.streams[result.stream_id];
    if (!info) return null;
    return info.datasetId === datasetId ? null : (info.name || info.datasetId);
  }

  function applyResponse(response: VideoSearchQueryResponse) {
    if (response.results) {
      state.results = response.results;
      // Keep adjudications for refs that are still present so marks
      // survive re-ranking across refinement rounds.
      const keep: Record<string, Adjudication | undefined> = {};
      response.results.forEach((r) => {
        keep[r.ref] = state.adjudications[r.ref];
      });
      state.adjudications = keep;
    }
    if (response.model_available) {
      state.modelAvailable = true;
    }
  }

  /**
   * Resolve an image on disk for a frame of any open dataset: the image
   * file itself for image sequences, or an extracted frame for videos.
   */
  async function imageForDatasetFrame(dsId: string, frameNum: number): Promise<string> {
    const media = await getMediaInfoFor(dsId);
    if (!media) {
      throw new Error(`Media for dataset ${dsId} is unavailable`);
    }
    if (media.type === 'video') {
      return videoSearchExtractFrame(media.getImagePath(frameNum), frameNum, media.fps);
    }
    const imagePath = media.getImagePath(frameNum);
    if (!imagePath) {
      throw new Error(`No image found for frame ${frameNum}`);
    }
    return imagePath;
  }

  async function exemplarImageForFrame(frameNum: number): Promise<string> {
    return imageForDatasetFrame(datasetId, frameNum);
  }

  /**
   * Start a new query from an image chip: exemplar image plus zero or more
   * boxes. Descriptors are computed once (on this dataset's primary
   * session) and the similarity query fans out to every open index.
   */
  async function queryFromImage(imagePath: string, boxes?: number[][], warmStartModelPath?: string) {
    await guarded('Searching...', async () => {
      await ensureSession();
      resetQueryState();
      let response = await videoSearchFormulate(imagePath, boxes);
      if (!response.results || warmStartModelPath) {
        response = await videoSearchQuery(
          warmStartModelPath ? { iqrModelPath: warmStartModelPath } : {},
        );
      }
      applyResponse(response);
    });
  }

  /** Start a new query from a frame of this dataset + boxes. */
  async function queryFromFrame(frameNum: number, boxes: number[][], warmStartModelPath?: string) {
    await guarded('Searching...', async () => {
      await ensureSession();
      resetQueryState();
      const imagePath = await exemplarImageForFrame(frameNum);
      let response = await videoSearchFormulate(imagePath, boxes);
      if (!response.results || warmStartModelPath) {
        response = await videoSearchQuery(
          warmStartModelPath ? { iqrModelPath: warmStartModelPath } : {},
        );
      }
      applyResponse(response);
    });
  }

  function mark(ref: string, adjudication: Adjudication) {
    if (state.adjudications[ref] === adjudication) {
      state.adjudications = { ...state.adjudications, [ref]: undefined };
    } else {
      state.adjudications = { ...state.adjudications, [ref]: adjudication };
    }
  }

  async function refine() {
    const positives: string[] = [];
    const negatives: string[] = [];
    Object.entries(state.adjudications).forEach(([ref, adj]) => {
      if (adj === 'positive') positives.push(ref);
      if (adj === 'negative') negatives.push(ref);
    });
    if (!positives.length && !negatives.length) {
      state.error = 'Mark at least one result as correct or incorrect before refining';
      return;
    }
    await guarded('Refining...', async () => {
      const response = await videoSearchRefine(positives, negatives);
      applyResponse(response);
      state.iteration += 1;
    });
  }

  async function saveModel(name: string): Promise<string | undefined> {
    return guarded('Saving model...', async () => {
      const { outputDir } = await videoSearchExportModel(name);
      return outputDir;
    });
  }

  async function closeSession() {
    await guarded('Closing...', async () => {
      await videoSearchClose();
      state.sessionOpen = false;
      state.streams = {};
    });
  }

  const context = {
    datasetId,
    state,
    getMediaInfo,
    getMediaInfoFor,
    refreshStatus,
    buildIndex,
    removeFromIndex,
    queryFromImage,
    queryFromFrame,
    exemplarImageForFrame,
    imageForDatasetFrame,
    resultDatasetId,
    resultDatasetName,
    mark,
    refine,
    saveModel,
    closeSession,
  };
  return context;
}

export type VideoSearchContextType = ReturnType<typeof createVideoSearch>;

export function provideVideoSearch(context: VideoSearchContextType) {
  provide(VideoSearchInjectKey, context);
}

export function useVideoSearch(): VideoSearchContextType | null {
  return inject<VideoSearchContextType | null>(VideoSearchInjectKey, null);
}
