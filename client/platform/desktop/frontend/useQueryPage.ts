/**
 * State behind the Query page: the datasets chosen for searching (with their
 * search index status and index building), one search session spanning every
 * indexed dataset, and the three ways to start a query: an image file, a frame
 * of a video or dataset, or a text prompt swept over the datasets' frames.
 */
import {
  computed, reactive, ref, Ref, watch,
} from 'vue';
import { JobType } from 'platform/desktop/constants';
import { orderedMultiCamCameraNames } from 'dive-common/multicamDisplay';
import type { ScoringDatasetSummary } from 'dive-common/scoring/types';
import type { VideoSearchIndexMethod, VideoSearchResult, VideoSearchIndexInfo } from 'dive-common/apispec';
import type { ReviewItem } from 'dive-common/review/types';
import {
  listScoringDatasets, loadConfig, segmentationSam3Installed, textQuery,
  videoInfo, videoSearchBuildIndex, videoSearchExtractFrame, videoSearchIndexStatus,
  videoSearchInstalled, videoSearchRemoveIndex, videoSearchListIndexes, videoSearchDeleteIndex,
} from 'platform/desktop/frontend/api';
import { runningJobs, recentHistory, queuedGpuJobs } from 'platform/desktop/frontend/store/jobs';
import { createVideoSearch } from 'platform/desktop/frontend/useVideoSearch';
import {
  textHitItem, textQueryFrames, textQueryHits, TextQueryHit,
} from './queryItems';

export type QueryIndexState = 'checking' | 'indexed' | 'not-indexed' | 'building' | 'error';

export interface QueryDataset {
  id: string;
  name: string;
  type?: string;
  index: QueryIndexState;
  error?: string;
}

export type QueryMode = 'image' | 'video' | 'text';

/** Where a video-frame query takes its frame from. */
export interface VideoQuerySource {
  kind: 'dataset' | 'file';
  datasetId: string;
  filePath: string;
  frame: number;
}

/** Index build jobs are titled "Add search index (...)" or "Update search index (...)". */
const BuildJobTitle = /search index/i;

// Keep the selected index rows when routing away; each visit reconciles disk and job state.
const selectedIndexRows = ref<QueryDataset[]>([]);

export function createQueryPage() {
  const available = ref<ScoringDatasetSummary[]>([]);
  const datasets = selectedIndexRows;
  const indexMembers = ref<VideoSearchIndexInfo[]>([]);
  const changingIndex = ref(false);
  const indexJobsActive = computed(() => runningJobs.value.some(({ job }) => BuildJobTitle.test(job.title))
    || queuedGpuJobs.value.some((job) => job.type === JobType.BuildSearchIndex));
  const indexActionsDisabled = computed(() => changingIndex.value || indexJobsActive.value || !!search.state.busy);
  const installed = ref<boolean | null>(null);
  const sam3Installed = ref<boolean | null>(null);
  const error = ref<string | null>(null);

  // One session searches every indexed dataset; results are filtered to the
  // chosen ones below.
  const search = createVideoSearch('', () => null);

  const mode = ref<QueryMode>('image');
  const imagePath = ref('');
  /** Exemplar box on the image, in image pixels, or null for the whole image. */
  const imageBox = ref<[number, number, number, number] | null>(null);
  const video = reactive<VideoQuerySource>({
    kind: 'dataset', datasetId: '', filePath: '', frame: 0,
  });
  /** Image on disk for the chosen video frame, once resolved. */
  const videoFramePath = ref('');
  const videoFrameBox = ref<[number, number, number, number] | null>(null);
  const warmStartModel = ref('');
  const onlySelected = ref(true);

  const text = reactive({
    prompt: '',
    threshold: 0.3,
    maxPerFrame: 10,
    stride: 30,
    maxFrames: 40,
  });
  const textHits = ref<TextQueryHit[]>([]);
  const textProgress = reactive({ running: false, done: 0, total: 0 });
  let textCancel = false;

  function fail(reason: unknown, fallback: string) {
    error.value = reason instanceof Error ? reason.message : String(reason || fallback);
  }

  function entry(id: string) {
    return datasets.value.find((d) => d.id === id);
  }

  function patch(id: string, changes: Partial<QueryDataset>) {
    datasets.value = datasets.value.map((d) => (d.id === id ? { ...d, ...changes } : d));
  }

  function datasetName(id: string) {
    return entry(id)?.name || available.value.find((d) => d.id === id)?.name || id;
  }

  async function refreshIndexMembers() {
    const members = await videoSearchListIndexes();
    const statuses = await Promise.all(members.map((member) => videoSearchIndexStatus(member.datasetId)));
    indexMembers.value = members.filter((_member, index) => statuses[index].indexed);
  }

  async function refreshAvailable() {
    try {
      available.value = await listScoringDatasets();
      if (installed.value === null) installed.value = await videoSearchInstalled();
      if (installed.value) await refreshIndexMembers();
      const indexed = indexMembers.value;
      const jobIds = recentHistory.value.filter(({ job }) => BuildJobTitle.test(job.title))
        .flatMap(({ job }) => job.datasetIds);
      // A stereo build job lists its parent for navigation and its child for indexing.
      const candidates = Array.from(new Set([...indexed.map((item) => item.datasetId), ...jobIds,
        ...queuedGpuJobs.value.filter((job) => job.type === JobType.BuildSearchIndex).map((job) => job.datasetId)]));
      await addDatasets(candidates.filter((id) => !candidates.some((other) => other.startsWith(`${id}/`))));
      await Promise.all(datasets.value.map((dataset) => refreshIndexStatus(dataset.id)));
      if (sam3Installed.value === null) {
        sam3Installed.value = (await segmentationSam3Installed()).installed;
      }
    } catch (err) {
      fail(err, 'Could not list datasets');
    }
  }

  async function refreshIndexStatus(id: string) {
    if (!entry(id)) return;
    if (queuedGpuJobs.value.some((job) => job.type === JobType.BuildSearchIndex && job.datasetId === id)) {
      patch(id, { index: 'building', error: undefined });
      return;
    }
    const latest = recentHistory.value.filter(({ job }) => (
      BuildJobTitle.test(job.title) && job.datasetIds.includes(id)
    )).sort((a, b) => +new Date(b.job.startTime) - +new Date(a.job.startTime))[0];
    if (latest && latest.job.endTime === undefined) {
      patch(id, { index: 'building', error: undefined });
      return;
    }
    if (latest && latest.job.exitCode !== 0) {
      const details = latest.truncatedLogs.slice(-8).join('\n');
      patch(id, { index: 'error', error: details || `Index generation failed (exit ${latest.job.exitCode ?? 'unknown'})` });
      return;
    }
    try {
      const status = await videoSearchIndexStatus(id);
      if (!entry(id)) return;
      const index = status.indexed ? 'indexed' : 'not-indexed';
      patch(id, { index: isBuilding(id) ? 'building' : index, error: undefined });
    } catch (err) {
      if (!entry(id)) return;
      patch(id, { index: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function addDataset(id: string, summary?: ScoringDatasetSummary) {
    if (!id || entry(id)) return;
    const known = summary || available.value.find((d) => d.id === id);
    if (!known || known.type === 'multi') {
      try {
        const config = await loadConfig(id);
        if (config.multiCamMedia) {
          const [camera] = orderedMultiCamCameraNames(config.multiCamMedia);
          if (!camera) throw new Error('This multicamera dataset has no cameras to index');
          await addDataset(`${id}/${camera}`, {
            ...known,
            id: `${id}/${camera}`,
            name: `${known?.name || config.name} / ${camera}`,
            type: config.multiCamMedia.cameras[camera].type,
          } as ScoringDatasetSummary);
          return;
        }
      } catch (err) { fail(err, 'Could not select the first camera'); return; }
    }
    datasets.value = [...datasets.value, {
      id, name: known?.name || id, type: known?.type, index: 'checking',
    }];
    await refreshIndexStatus(id);
  }

  async function addDatasets(ids: string[]) {
    await Promise.all(Array.from(new Set(ids.filter(Boolean))).map((id) => addDataset(id)));
  }

  function removeDataset(id: string) {
    datasets.value = datasets.value.filter((d) => d.id !== id);
  }

  function isBuilding(id: string) {
    return queuedGpuJobs.value.some((job) => job.type === JobType.BuildSearchIndex && job.datasetId === id)
      || runningJobs.value.some((item) => (
        item.job.exitCode === null
      && item.job.datasetIds.includes(id)
      && BuildJobTitle.test(item.job.title)
      ));
  }

  /** How long a queued build may take to show up as a running job. */
  const BuildStartGraceMs = 20000;

  /** Queue an index build (a GPU job) for each dataset given. */
  function buildIndex(ids: string[], method: VideoSearchIndexMethod) {
    if (changingIndex.value) return;
    ids.forEach((id) => {
      if (!entry(id) || isBuilding(id)) return;
      videoSearchBuildIndex(id, method);
      patch(id, { index: 'building', error: undefined });
      // A build that never starts (e.g. an invalid VIAME path) leaves no
      // running job behind; fall back to the real status after a grace period.
      window.setTimeout(() => {
        if (entry(id)?.index === 'building' && !isBuilding(id)) refreshIndexStatus(id);
      }, BuildStartGraceMs);
    });
  }

  async function changeIndex(remove: () => Promise<unknown>) {
    if (indexActionsDisabled.value) return;
    changingIndex.value = true;
    error.value = null;
    try {
      await remove();
      search.state.sessionOpen = false;
      search.state.streams = {};
      search.state.results = [];
      search.state.adjudications = {};
      search.state.modelAvailable = false;
      await refreshIndexMembers();
      await Promise.all(datasets.value.map((dataset) => refreshIndexStatus(dataset.id)));
    } catch (err) {
      fail(err, 'Could not update the search index');
    } finally { changingIndex.value = false; }
  }

  async function removeFromIndex(id: string) {
    await changeIndex(() => videoSearchRemoveIndex(id));
  }

  async function deleteEntireIndex() {
    await changeIndex(() => videoSearchDeleteIndex());
  }

  // Observe terminal state as well as running jobs, so failures remain visible on return.
  watch(() => recentHistory.value.map(({ job }) => `${job.key}:${job.endTime}:${job.exitCode}`).join('|'), () => {
    search.state.sessionOpen = false;
    datasets.value.forEach((dataset) => { refreshIndexStatus(dataset.id); });
    if (installed.value) refreshIndexMembers().catch((err) => fail(err, 'Could not list indexed sequences'));
  });

  const indexedIds = computed(() => datasets.value.filter((d) => d.index === 'indexed').map((d) => d.id));
  const canSearch = computed(() => installed.value === true && indexedIds.value.length > 0 && !search.state.busy);

  /** Similarity results, limited to the chosen datasets unless asked otherwise. */
  const results = computed<VideoSearchResult[]>(() => {
    const all = search.state.results;
    if (!onlySelected.value) return all;
    const chosen = new Set(datasets.value.map((d) => d.id));
    return all.filter((r) => {
      const id = search.resultDatasetId(r);
      return id !== null && chosen.has(id);
    });
  });

  // ---- image and video-frame queries -----------------------------------

  async function runImageQuery() {
    if (!imagePath.value) return;
    error.value = null;
    const boxes = imageBox.value ? [[...imageBox.value]] : undefined;
    await search.queryFromImage(imagePath.value, boxes, warmStartModel.value || undefined);
  }

  /** Resolve the chosen video frame to an image on disk (extracting it for videos). */
  async function resolveVideoFrame(): Promise<string> {
    if (video.kind === 'dataset') {
      if (!video.datasetId) throw new Error('Choose a dataset');
      return search.imageForDatasetFrame(video.datasetId, video.frame);
    }
    if (!video.filePath) throw new Error('Choose a video file');
    const info = await videoInfo(video.filePath);
    return videoSearchExtractFrame(video.filePath, video.frame, info.fps);
  }

  async function previewVideoFrame() {
    error.value = null;
    try {
      videoFramePath.value = await resolveVideoFrame();
      videoFrameBox.value = null;
    } catch (err) {
      fail(err, 'Could not read that frame');
    }
  }

  async function runVideoQuery() {
    error.value = null;
    try {
      if (!videoFramePath.value) videoFramePath.value = await resolveVideoFrame();
    } catch (err) {
      fail(err, 'Could not read that frame');
      return;
    }
    const boxes = videoFrameBox.value ? [[...videoFrameBox.value]] : undefined;
    await search.queryFromImage(videoFramePath.value, boxes, warmStartModel.value || undefined);
  }

  /** Start a similarity search from one text hit, box included. */
  async function searchSimilarTo(hit: TextQueryHit) {
    error.value = null;
    await search.queryFromImage(hit.imagePath, [[...hit.box]]);
  }

  // ---- text queries ---------------------------------------------------------

  /** Frames of a dataset: image count, or null (unknown) for videos. */
  async function frameCountOf(id: string): Promise<number | null> {
    const config = await loadConfig(id);
    if (config.type === 'video') return null;
    return config.imageData?.length ?? null;
  }

  async function runTextQuery() {
    const prompt = text.prompt.trim();
    if (!prompt || textProgress.running) return;
    error.value = null;
    textCancel = false;
    textHits.value = [];
    const targets = datasets.value.map((d) => d.id);
    const plan: { id: string; frames: number[] }[] = [];
    try {
      await Promise.all(targets.map(async (id) => {
        const frames = textQueryFrames(await frameCountOf(id), text.stride, text.maxFrames);
        plan.push({ id, frames });
      }));
    } catch (err) {
      fail(err, 'Could not plan the text query');
      return;
    }
    textProgress.running = true;
    textProgress.done = 0;
    textProgress.total = plan.reduce((sum, p) => sum + p.frames.length, 0);
    try {
      // The segmentation service handles one request at a time.
      // eslint-disable-next-line no-restricted-syntax
      for (const { id, frames } of plan) {
        // eslint-disable-next-line no-restricted-syntax
        for (const frame of frames) {
          if (textCancel) return;
          try {
            // eslint-disable-next-line no-await-in-loop
            const image = await search.imageForDatasetFrame(id, frame);
            // eslint-disable-next-line no-await-in-loop
            const response = await textQuery({
              imagePath: image,
              text: prompt,
              boxThreshold: text.threshold,
              maxDetections: text.maxPerFrame,
            });
            if (response.success && response.detections?.length) {
              textHits.value = [...textHits.value, ...textQueryHits(id, frame, image, response.detections)];
            } else if (!response.success && response.error) {
              throw new Error(response.error);
            }
          } catch (err) {
            fail(err, `Text query failed on ${datasetName(id)} frame ${frame}`);
            return;
          } finally {
            textProgress.done += 1;
          }
        }
      }
    } finally {
      textProgress.running = false;
    }
  }

  function cancelTextQuery() {
    textCancel = true;
  }

  const textItems: Ref<ReviewItem[]> = computed(() => textHits.value.map(textHitItem));

  function hitOf(key: string) {
    return textHits.value.find((hit) => hit.key === key);
  }

  function clearError() {
    error.value = null;
  }

  return {
    available,
    datasets,
    indexMembers,
    indexActionsDisabled,
    changingIndex,
    deleteEntireIndex,
    installed,
    sam3Installed,
    error,
    search,
    mode,
    imagePath,
    imageBox,
    video,
    videoFramePath,
    videoFrameBox,
    warmStartModel,
    onlySelected,
    text,
    textHits,
    textItems,
    textProgress,
    indexedIds,
    canSearch,
    results,
    datasetName,
    refreshAvailable,
    addDataset,
    addDatasets,
    removeDataset,
    refreshIndexStatus,
    buildIndex,
    removeFromIndex,
    isBuilding,
    runImageQuery,
    previewVideoFrame,
    runVideoQuery,
    searchSimilarTo,
    runTextQuery,
    cancelTextQuery,
    hitOf,
    clearError,
  };
}

export type QueryPageState = ReturnType<typeof createQueryPage>;
