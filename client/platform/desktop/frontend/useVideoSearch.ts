/**
 * Video search / IQR session state shared between ViewerLoader (which owns
 * dataset media details) and the VideoSearchContext side panel.
 *
 * Created and provided by ViewerLoader; injected by the panel.
 */
import { reactive, provide, inject } from 'vue';
import type {
  VideoSearchIndexStatus, VideoSearchIndexMethod,
  VideoSearchResult, VideoSearchQueryResponse,
} from 'dive-common/apispec';
import {
  videoSearchInstalled, videoSearchIndexStatus, videoSearchBuildIndex,
  videoSearchDeleteIndex, videoSearchOpenIndex, videoSearchFormulate,
  videoSearchQuery, videoSearchRefine, videoSearchExportModel,
  videoSearchClose, videoSearchExtractFrame,
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
  /** Human-readable description of the operation in flight, or null. */
  busy: string | null;
  error: string | null;
  results: VideoSearchResult[];
  adjudications: Record<number, Adjudication | undefined>;
  /** Completed refinement iterations for the active query. */
  iteration: number;
  modelAvailable: boolean;
}

export function createVideoSearch(
  datasetId: string,
  getMediaInfo: () => VideoSearchMediaInfo | null,
) {
  const state = reactive<VideoSearchState>({
    installed: null,
    status: null,
    sessionOpen: false,
    busy: null,
    error: null,
    results: [],
    adjudications: {},
    iteration: 0,
    modelAvailable: false,
  });

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

  async function deleteIndex() {
    await guarded('Deleting index...', async () => {
      await videoSearchDeleteIndex(datasetId);
      state.sessionOpen = false;
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

  async function ensureSession() {
    if (!state.sessionOpen) {
      await videoSearchOpenIndex(datasetId);
      state.sessionOpen = true;
    }
  }

  function applyResponse(response: VideoSearchQueryResponse) {
    if (response.results) {
      state.results = response.results;
      // Keep adjudications for instance ids that are still present so marks
      // survive re-ranking across refinement rounds.
      const keep: Record<number, Adjudication | undefined> = {};
      response.results.forEach((r) => {
        keep[r.instance_id] = state.adjudications[r.instance_id];
      });
      state.adjudications = keep;
    }
    if (response.model_available) {
      state.modelAvailable = true;
    }
  }

  /**
   * Resolve an exemplar image for a frame: the image file itself for image
   * sequences, or an extracted frame for videos.
   */
  async function exemplarImageForFrame(frameNum: number): Promise<string> {
    const media = getMediaInfo();
    if (!media) {
      throw new Error('Dataset media has not finished loading');
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

  /**
   * Start a new query from an image chip: exemplar image plus zero or more
   * boxes. With boxes, the backend runs the similarity query in the same
   * step; without them, an explicit query pass follows.
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

  function mark(instanceId: number, adjudication: Adjudication) {
    if (state.adjudications[instanceId] === adjudication) {
      state.adjudications = { ...state.adjudications, [instanceId]: undefined };
    } else {
      state.adjudications = { ...state.adjudications, [instanceId]: adjudication };
    }
  }

  async function refine() {
    const positives: number[] = [];
    const negatives: number[] = [];
    Object.entries(state.adjudications).forEach(([id, adj]) => {
      if (adj === 'positive') positives.push(Number(id));
      if (adj === 'negative') negatives.push(Number(id));
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
    });
  }

  const context = {
    datasetId,
    state,
    getMediaInfo,
    refreshStatus,
    buildIndex,
    deleteIndex,
    queryFromImage,
    queryFromFrame,
    exemplarImageForFrame,
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
