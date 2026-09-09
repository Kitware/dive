/**
 * State behind the Review page: the datasets under review (with their
 * tracks held in memory), the query, the grid settings, the rendered
 * chips, and the type edits waiting to be saved back.
 */
import {
  computed, inject, provide, reactive, ref, Ref, watch,
} from 'vue';
import type { Api, DatasetConfig } from 'dive-common/apispec';
import type { ScoringDatasetSummary } from 'dive-common/scoring/types';
import type { TrackData } from 'vue-media-annotator/track';
import type { AnnotationId, ConfidencePair } from 'vue-media-annotator/BaseAnnotation';
import {
  acceptPairAsCorrect, compileHierarchy, reassignPairs, TypeHierarchyIndex,
} from 'dive-common/typeHierarchy';
import { createFrameSource, FrameSource } from 'dive-common/review/frameSource';
import { createChipStore, ChipStore } from 'dive-common/review/chipStore';
import {
  buildReviewItems, collectAttributeKeys, collectTypes, sortReviewItems,
} from 'dive-common/review/reviewItems';
import { usePersistentGridSettings } from 'dive-common/review/gridSettings';
import {
  DEFAULT_REVIEW_QUERY,
  ReviewGridSettings,
  ReviewItem,
  ReviewQuery,
  ReviewSortOrder,
} from 'dive-common/review/types';

const CHIP_OUTLINE = '#00e5ff';

export type ReviewApi = Pick<Api,
  'loadConfig' | 'peekConfig' | 'loadDetections' | 'saveDetections'
  | 'listScoringDatasets' | 'pickScoringDataset'>;

export interface ReviewServiceDeps {
  api: ReviewApi;
}

export type ReviewDatasetStatus = 'loading' | 'ready' | 'error';

export interface ReviewDataset {
  id: string;
  name: string;
  type?: string;
  status: ReviewDatasetStatus;
  error?: string;
  trackCount: number;
  /** True when the media can be cropped into chips. */
  croppable: boolean;
}

export interface ReviewService {
  datasets: Readonly<Ref<ReviewDataset[]>>;
  available: Readonly<Ref<ScoringDatasetSummary[]>>;
  query: ReviewQuery;
  grid: ReviewGridSettings;
  sort: Ref<ReviewSortOrder>;
  items: Readonly<Ref<ReviewItem[]>>;
  /** Bumps whenever tracks load or change; computeds that read tracks depend on it. */
  dataRevision: Readonly<Ref<number>>;
  /** True once tracks or the query changed after the last run. */
  stale: Readonly<Ref<boolean>>;
  types: Readonly<Ref<string[]>>;
  attributeKeys: Readonly<Ref<string[]>>;
  pendingCount: Readonly<Ref<number>>;
  saving: Readonly<Ref<boolean>>;
  loading: Readonly<Ref<boolean>>;
  error: Readonly<Ref<string | null>>;
  chipStore: ChipStore;
  datasetName(id: string): string;
  refreshAvailable(): Promise<void>;
  addDataset(id: string, summary?: ScoringDatasetSummary): Promise<void>;
  addDatasets(ids: string[]): Promise<void>;
  removeDataset(id: string): void;
  reloadDataset(id: string): Promise<void>;
  runQuery(): void;
  trackOf(datasetId: string, trackId: AnnotationId): TrackData | undefined;
  /** The item's live top type/confidence after any edits. */
  currentType(item: ReviewItem): { type: string; confidence: number };
  isPending(item: ReviewItem): boolean;
  assignType(item: ReviewItem, type: string): void;
  acceptType(item: ReviewItem): void;
  save(): Promise<void>;
  discardChanges(): Promise<void>;
  clearError(): void;
  dispose(): void;
}

interface LoadedDataset {
  config: DatasetConfig;
  tracks: Map<AnnotationId, TrackData>;
  hierarchy: TypeHierarchyIndex;
  frameSource: FrameSource | null;
  pending: Set<AnnotationId>;
}

function topPair(pairs: readonly ConfidencePair[]): { type: string; confidence: number } {
  const top = pairs.reduce<ConfidencePair | null>(
    (acc, pair) => (acc === null || pair[1] > acc[1] ? pair : acc),
    null,
  );
  return top ? { type: top[0], confidence: top[1] } : { type: '', confidence: 0 };
}

export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  const { api } = deps;
  const datasets = ref<ReviewDataset[]>([]);
  const available = ref<ScoringDatasetSummary[]>([]);
  const query = reactive<ReviewQuery>({ ...DEFAULT_REVIEW_QUERY });
  const grid = usePersistentGridSettings();
  const sort = ref<ReviewSortOrder>('dataset');
  const items = ref<ReviewItem[]>([]);
  const dataRevision = ref(0);
  const stale = ref(false);
  const saving = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Tracks and media, deliberately outside Vue reactivity (they can be large). */
  const loaded = new Map<string, LoadedDataset>();
  /** Loads still in flight, so a removal during load is honoured. */
  let loadGeneration = 0;

  watch(query, () => { stale.value = true; }, { deep: true });

  const chipStore = createChipStore({
    frameSourceFor: (datasetId) => loaded.get(datasetId)?.frameSource ?? null,
  }, {
    padding: grid.padding, size: 256, aspect: 1, outline: CHIP_OUTLINE,
  });

  function fail(reason: unknown, fallback: string) {
    const message = reason instanceof Error ? reason.message : String(reason || fallback);
    error.value = message || fallback;
  }

  function datasetName(id: string) {
    return datasets.value.find((d) => d.id === id)?.name
      || available.value.find((d) => d.id === id)?.name
      || id;
  }

  function entry(id: string) {
    return datasets.value.find((d) => d.id === id);
  }

  function patch(id: string, changes: Partial<ReviewDataset>) {
    datasets.value = datasets.value.map((d) => (d.id === id ? { ...d, ...changes } : d));
  }

  async function refreshAvailable() {
    if (!api.listScoringDatasets) return;
    try {
      available.value = await api.listScoringDatasets();
    } catch (err) {
      fail(err, 'Could not list datasets');
    }
  }

  function loadConfig(id: string) {
    return api.peekConfig ? api.peekConfig(id) : api.loadConfig(id);
  }

  function frameSourceFor(config: DatasetConfig): FrameSource | null {
    try {
      return createFrameSource(config);
    } catch {
      return null;
    }
  }

  function dropLoaded(id: string) {
    const existing = loaded.get(id);
    if (existing) {
      existing.frameSource?.dispose();
      loaded.delete(id);
    }
  }

  async function load(id: string, generation: number) {
    loading.value = true;
    try {
      const config = await loadConfig(id);
      if (generation !== loadGeneration || !entry(id)) return;
      if (config.type === 'multi') {
        // Review the cameras of a multicamera dataset as separate sequences.
        const cameras = Object.keys(config.multiCamMedia?.cameras || {});
        const parentName = entry(id)?.name || config.name;
        datasets.value = datasets.value.filter((d) => d.id !== id);
        await Promise.all(cameras.map((camera) => addDataset(`${id}/${camera}`, {
          id: `${id}/${camera}`, name: `${parentName} (${camera})`, type: config.multiCamMedia?.cameras[camera]?.type,
        })));
        return;
      }
      const detections = await api.loadDetections(id);
      if (generation !== loadGeneration || !entry(id)) return;
      dropLoaded(id);
      const tracks = new Map<AnnotationId, TrackData>();
      detections.tracks.forEach((track) => tracks.set(track.id, track));
      const frameSource = frameSourceFor(config);
      loaded.set(id, {
        config,
        tracks,
        hierarchy: compileHierarchy(config.typeHierarchy || {}),
        frameSource,
        pending: new Set(),
      });
      patch(id, {
        status: 'ready',
        error: undefined,
        name: entry(id)?.name || config.name,
        type: config.type,
        trackCount: tracks.size,
        croppable: frameSource !== null,
      });
      dataRevision.value += 1;
      stale.value = true;
    } catch (err) {
      if (generation !== loadGeneration || !entry(id)) return;
      patch(id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      loading.value = datasets.value.some((d) => d.status === 'loading');
    }
  }

  async function addDataset(id: string, summary?: ScoringDatasetSummary) {
    if (!id || entry(id)) return;
    datasets.value = [...datasets.value, {
      id,
      name: summary?.name || datasetName(id),
      type: summary?.type,
      status: 'loading',
      trackCount: 0,
      croppable: false,
    }];
    await load(id, loadGeneration);
  }

  async function addDatasets(ids: string[]) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    await Promise.all(unique.map((id) => addDataset(id)));
  }

  function removeDataset(id: string) {
    datasets.value = datasets.value.filter((d) => d.id !== id);
    dropLoaded(id);
    loadGeneration += 1;
    dataRevision.value += 1;
    stale.value = true;
  }

  async function reloadDataset(id: string) {
    if (!entry(id)) return;
    patch(id, { status: 'loading', error: undefined });
    await load(id, loadGeneration);
  }

  function allTracks(): TrackData[] {
    const all: TrackData[] = [];
    loaded.forEach((dataset) => all.push(...dataset.tracks.values()));
    return all;
  }

  /** Read inside a computed so it re-runs when tracks load or change. */
  function dependOnData(): number {
    return dataRevision.value;
  }

  const types = computed(() => {
    dependOnData();
    return collectTypes(allTracks());
  });

  const attributeKeys = computed(() => {
    dependOnData();
    const keys = new Set<string>();
    loaded.forEach((dataset) => {
      collectAttributeKeys(dataset.tracks.values(), dataset.config.attributes).forEach((k) => keys.add(k));
    });
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  });

  function runQuery() {
    const order = datasets.value.map((d) => d.id);
    const built: ReviewItem[] = [];
    order.forEach((id) => {
      const dataset = loaded.get(id);
      if (dataset) {
        built.push(...buildReviewItems(id, dataset.tracks.values(), { ...query }, grid.maxSequenceFrames));
      }
    });
    items.value = sortReviewItems(built, sort.value, order);
    stale.value = false;
  }

  watch(sort, () => {
    items.value = sortReviewItems(items.value, sort.value, datasets.value.map((d) => d.id));
  });

  function trackOf(datasetId: string, trackId: AnnotationId) {
    return loaded.get(datasetId)?.tracks.get(trackId);
  }

  function currentType(item: ReviewItem) {
    const track = trackOf(item.datasetId, item.trackId);
    if (!track) return { type: item.type, confidence: item.confidence };
    if (query.mode === 'type' && query.type) {
      // Keep showing the queried pair while it still exists, so an edit that
      // demotes it is visible as such.
      const pair = track.confidencePairs.find(([type]) => type === query.type);
      const top = topPair(track.confidencePairs);
      if (pair && top.type === query.type) return { type: pair[0], confidence: pair[1] };
      return top;
    }
    return topPair(track.confidencePairs);
  }

  function isPending(item: ReviewItem) {
    return loaded.get(item.datasetId)?.pending.has(item.trackId) ?? false;
  }

  const pendingCount = computed(() => {
    dependOnData();
    let count = 0;
    loaded.forEach((dataset) => { count += dataset.pending.size; });
    return count;
  });

  function updatePairs(item: ReviewItem, update: (pairs: ConfidencePair[], hierarchy: TypeHierarchyIndex) => ConfidencePair[]) {
    const dataset = loaded.get(item.datasetId);
    const track = dataset?.tracks.get(item.trackId);
    if (!dataset || !track) return;
    const next = update(track.confidencePairs.map(([t, c]) => [t, c] as ConfidencePair), dataset.hierarchy);
    track.confidencePairs = next;
    dataset.pending.add(item.trackId);
    dataRevision.value += 1;
  }

  function assignType(item: ReviewItem, type: string) {
    const trimmed = type.trim();
    if (!trimmed) return;
    const current = currentType(item);
    if (current.type === trimmed && current.confidence >= 1) return;
    updatePairs(item, (pairs, hierarchy) => reassignPairs(
      hierarchy,
      pairs,
      current.type || trimmed,
      trimmed,
      1,
    ));
  }

  function acceptType(item: ReviewItem) {
    const current = currentType(item);
    if (!current.type) return;
    updatePairs(item, (pairs, hierarchy) => acceptPairAsCorrect(hierarchy, pairs, current.type));
  }

  async function save() {
    if (saving.value) return;
    saving.value = true;
    error.value = null;
    try {
      const targets = Array.from(loaded.entries()).filter(([, d]) => d.pending.size > 0);
      const results = await Promise.allSettled(targets.map(async ([id, dataset]) => {
        const upsert = Array.from(dataset.pending)
          .map((trackId) => dataset.tracks.get(trackId))
          .filter((t): t is TrackData => !!t);
        await api.saveDetections(id, {
          tracks: { upsert, delete: [] },
          groups: { upsert: [], delete: [] },
        });
        dataset.pending.clear();
      }));
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (failed) throw failed.reason;
    } catch (err) {
      fail(err, 'Could not save the changed annotations');
    } finally {
      dataRevision.value += 1;
      saving.value = false;
    }
  }

  async function discardChanges() {
    const dirty = Array.from(loaded.entries()).filter(([, d]) => d.pending.size > 0).map(([id]) => id);
    await Promise.all(dirty.map((id) => reloadDataset(id)));
  }

  function clearError() {
    error.value = null;
  }

  function dispose() {
    loadGeneration += 1;
    loaded.forEach((dataset) => dataset.frameSource?.dispose());
    loaded.clear();
    chipStore.reset();
  }

  return {
    datasets,
    available,
    query,
    grid,
    sort,
    items,
    dataRevision,
    stale,
    types,
    attributeKeys,
    pendingCount,
    saving,
    loading,
    error,
    chipStore,
    datasetName,
    refreshAvailable,
    addDataset,
    addDatasets,
    removeDataset,
    reloadDataset,
    runQuery,
    trackOf,
    currentType,
    isPending,
    assignType,
    acceptType,
    save,
    discardChanges,
    clearError,
    dispose,
  };
}

const ReviewSymbol = Symbol('review');

export function provideReview(service: ReviewService) {
  provide(ReviewSymbol, service);
}

export function useReview(): ReviewService {
  const service = inject<ReviewService | null>(ReviewSymbol, null);
  if (!service) {
    throw new Error('Review service not provided');
  }
  return service;
}
