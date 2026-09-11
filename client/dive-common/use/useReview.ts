/**
 * State behind the Review page: the datasets under review (with their
 * tracks held in memory), the query, the grid settings, the rendered
 * chips, and the type edits waiting to be saved back.
 */
import {
  computed, effectScope, inject, provide, reactive, ref, Ref, watch,
} from 'vue';
import { debounce } from 'lodash';
import type { Api, DatasetConfig } from 'dive-common/apispec';
import type { ScoringDatasetSummary } from 'dive-common/scoring/types';
import type { Feature, TrackData } from 'vue-media-annotator/track';
import type { AnnotationId, ConfidencePair } from 'vue-media-annotator/BaseAnnotation';
import type { RectBounds } from 'vue-media-annotator/utils';
import StyleManager from 'vue-media-annotator/StyleManager';
import {
  acceptPairAsCorrect, compileHierarchy, reassignPairs, TypeHierarchyIndex,
} from 'dive-common/typeHierarchy';
import { createFrameSource, FrameSource } from 'dive-common/review/frameSource';
import createReviewRequestQueue from 'dive-common/review/requestQueue';
import { createChipStore, ChipStore } from 'dive-common/review/chipStore';
import {
  buildReviewItems, CameraMembership, collectAttributeKeys, collectTypes, frameRefFor, groupReviewItems,
  sortReviewItems,
} from 'dive-common/review/reviewItems';
import { usePersistentGridSettings } from 'dive-common/review/gridSettings';
import {
  DEFAULT_REVIEW_QUERY,
  ReviewEntry,
  ReviewGridSettings,
  ReviewItem,
  ReviewPolygon,
  ReviewQuery,
  ReviewSortOrder,
} from 'dive-common/review/types';

const CHIP_OUTLINE = '#00e5ff';

/** Geometry edits for one keyframe; omitted fields are left alone, null removes a point. */
export interface ReviewGeometryEdit {
  bounds?: RectBounds;
  polygons?: ReviewPolygon[];
  head?: [number, number] | null;
  tail?: [number, number] | null;
}

export type ReviewApi = Pick<Api,
  'loadConfig' | 'peekConfig' | 'loadDetections' | 'loadReviewTracks' | 'saveDetections'
  | 'listScoringDatasets' | 'pickScoringDataset'>;

export interface ReviewServiceDeps {
  api: ReviewApi;
}

/** `queued` datasets were picked but load only once results are wanted. */
export type ReviewDatasetStatus = 'queued' | 'loading' | 'ready' | 'error';

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
  /** Items grouped into grid entries (one per track across its cameras). */
  entries: Readonly<Ref<ReviewEntry[]>>;
  /** Bumps whenever tracks load or change; computeds that read tracks depend on it. */
  dataRevision: Readonly<Ref<number>>;
  /** True once tracks or the query changed after the last run. */
  stale: Readonly<Ref<boolean>>;
  types: Readonly<Ref<string[]>>;
  knownTypes: Readonly<Ref<string[]>>;
  attributeKeys: Readonly<Ref<string[]>>;
  pendingCount: Readonly<Ref<number>>;
  saving: Readonly<Ref<boolean>>;
  loading: Readonly<Ref<boolean>>;
  error: Readonly<Ref<string | null>>;
  chipStore: ChipStore;
  datasetName(id: string): string;
  refreshAvailable(): Promise<void>;
  addDataset(id: string, summary?: ScoringDatasetSummary, options?: { defer?: boolean }): Promise<void>;
  loadQueued(): Promise<void>;
  addDatasets(ids: string[]): Promise<void>;
  removeDataset(id: string): void;
  reloadDataset(id: string): Promise<void>;
  runQuery(): void;
  trackOf(datasetId: string, trackId: AnnotationId): TrackData | undefined;
  /** The item's live top type/confidence after any edits. */
  currentType(item: ReviewItem): { type: string; confidence: number };
  /** The colour the annotator draws a type in (custom dataset styles applied). */
  colorFor(type: string): string;
  /** Frames per second the dataset is annotated at, or 0 when unknown. */
  datasetFps(id: string): number;
  /** The multicamera parent a camera dataset was expanded from, or the id itself. */
  parentOf(id: string): string;
  /** Add a keyframe with a box to a track, e.g. where one camera lacks a detection. */
  addKeyframe(item: ReviewItem, frame: number, bounds: RectBounds): void;
  /** Remove the track behind an item; written on the next save. */
  deleteTrack(item: ReviewItem): void;
  isPending(item: ReviewItem): boolean;
  assignType(item: ReviewItem, type: string): void;
  acceptType(item: ReviewItem): void;
  /** Change a keyframe's box, polygons or head/tail points; re-renders the item's chips. */
  updateGeometry(item: ReviewItem, frame: number, edit: ReviewGeometryEdit): void;
  save(): Promise<void>;
  discardChanges(): Promise<boolean>;
  refreshOnResume(): Promise<boolean>;
  clearError(): void;
  dispose(): void;
}

interface LoadedDataset {
  config: DatasetConfig;
  tracks: Map<AnnotationId, TrackData>;
  hierarchy: TypeHierarchyIndex;
  frameSource: FrameSource | null;
  pending: Set<AnnotationId>;
  /**
   * Monotonic edit version per pending track. A save snapshots these and only
   * acknowledges a track when the version still matches, so an edit made while
   * the request is in flight stays dirty.
   */
  pendingVersions: Map<AnnotationId, number>;
  /** Tracks removed here and not yet deleted on the platform. */
  deleted: Set<AnnotationId>;
}

type GeoFeature = NonNullable<Feature['geometry']>['features'][number];

function featureKey(geo: GeoFeature): unknown {
  return (geo.properties as { key?: unknown } | null)?.key;
}

/** Write a head/tail point into the keyframe the way DIVE stores it. */
function setKeypoint(feature: Feature, key: 'head' | 'tail', point: [number, number] | null) {
  const collection = feature.geometry || { type: 'FeatureCollection' as const, features: [] };
  const remaining = collection.features.filter(
    (geo) => !(geo.geometry.type === 'Point' && featureKey(geo) === key),
  );
  if (point) {
    remaining.push({
      type: 'Feature',
      properties: { key },
      geometry: { type: 'Point', coordinates: [point[0], point[1]] },
    });
  }
  collection.features = remaining;
  // eslint-disable-next-line no-param-reassign
  feature.geometry = collection;
  if (point) {
    // eslint-disable-next-line no-param-reassign
    feature[key] = [point[0], point[1]];
  } else {
    // eslint-disable-next-line no-param-reassign
    delete feature[key];
  }
}

/** Keep the head-to-tail line in step with its end points. */
function syncHeadTailLine(feature: Feature) {
  const collection = feature.geometry;
  if (!collection) return;
  const head = collection.features.find((g) => g.geometry.type === 'Point' && featureKey(g) === 'head');
  const tail = collection.features.find((g) => g.geometry.type === 'Point' && featureKey(g) === 'tail');
  collection.features = collection.features.filter(
    (geo) => !(geo.geometry.type === 'LineString' && featureKey(geo) === 'HeadTails'),
  );
  if (head && tail && head.geometry.type === 'Point' && tail.geometry.type === 'Point') {
    collection.features.push({
      type: 'Feature',
      properties: { key: 'HeadTails' },
      geometry: { type: 'LineString', coordinates: [head.geometry.coordinates, tail.geometry.coordinates] },
    });
  }
}

/** Replace the outer rings of the keyframe's polygons, in order. */
function setPolygons(feature: Feature, polygons: ReviewPolygon[]) {
  const collection = feature.geometry;
  if (!collection) return;
  let index = 0;
  collection.features.forEach((geo) => {
    if (geo.geometry.type !== 'Polygon') return;
    const ring = polygons[index];
    index += 1;
    if (!ring || ring.length < 3) return;
    const holes = geo.geometry.coordinates.slice(1);
    // eslint-disable-next-line no-param-reassign
    geo.geometry.coordinates = [[...ring.map(([x, y]) => [x, y]), [ring[0][0], ring[0][1]]], ...holes];
  });
}

function topPair(pairs: readonly ConfidencePair[]): { type: string; confidence: number } {
  const top = pairs.reduce<ConfidencePair | null>(
    (acc, pair) => (acc === null || pair[1] > acc[1] ? pair : acc),
    null,
  );
  return top ? { type: top[0], confidence: top[1] } : { type: '', confidence: 0 };
}

export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  const scope = effectScope(true);
  const service = scope.run(() => createScopedReviewService(deps))!;
  const { dispose } = service;
  service.dispose = () => {
    dispose();
    scope.stop();
  };
  return service;
}

function createScopedReviewService(deps: ReviewServiceDeps): ReviewService {
  const { api } = deps;
  const requests = createReviewRequestQueue();
  let disposed = false;
  const datasets = ref<ReviewDataset[]>([]);
  const available = ref<ScoringDatasetSummary[]>([]);
  const query = reactive<ReviewQuery>({ ...DEFAULT_REVIEW_QUERY });
  const grid = usePersistentGridSettings();
  const sort = ref<ReviewSortOrder>('confidence-desc');
  const items = ref<ReviewItem[]>([]);
  const dataRevision = ref(0);
  const stale = ref(false);
  const saving = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Tracks and media, deliberately outside Vue reactivity (they can be large). */
  const loaded = new Map<string, LoadedDataset>();
  /** Loads still in flight, so a removal during load is honoured. */
  const loadTokens = new Map<string, symbol>();
  /** Type colours as the annotator assigns them, seeded from each dataset's custom styles. */
  const styles = new StyleManager({ markChangesPending: () => undefined });
  /** Camera datasets expanded from a multicamera parent. */
  const memberships = new Map<string, CameraMembership>();

  // Query changes apply as soon as they settle; the grid only reshuffles
  // for those, never for edits made in it.
  const runQuerySettled = debounce(() => runQuery(), 200);
  watch(query, () => {
    stale.value = true;
    runQuerySettled();
  }, { deep: true });

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
      const result = await requests.run(() => api.listScoringDatasets!());
      if (!disposed) available.value = result;
    } catch (err) {
      fail(err, 'Could not list datasets');
    }
  }

  function loadConfig(id: string) {
    return api.peekConfig ? api.peekConfig(id) : api.loadConfig(id);
  }

  function frameSourceFor(config: DatasetConfig): FrameSource | null {
    try {
      return createFrameSource(config, { cacheSize: 2, cacheBytes: 16 * 1024 * 1024 });
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

  async function load(id: string) {
    const token = Symbol(id);
    loadTokens.set(id, token);
    const isCurrent = () => loadTokens.get(id) === token && !!entry(id);
    loading.value = true;
    try {
      const config = await requests.run(() => {
        if (!isCurrent()) throw new Error('Dataset removed');
        return loadConfig(id);
      });
      if (!isCurrent()) return;
      if (config.type === 'multi') {
        // Review the cameras of a multicamera dataset as separate sequences.
        const cameras = Object.keys(config.multiCamMedia?.cameras || {});
        const parentName = entry(id)?.name || config.name;
        datasets.value = datasets.value.filter((d) => d.id !== id);
        cameras.forEach((camera, rank) => memberships.set(`${id}/${camera}`, { parent: id, camera, rank }));
        await Promise.all(cameras.map((camera) => addDataset(`${id}/${camera}`, {
          id: `${id}/${camera}`, name: `${parentName} (${camera})`, type: config.multiCamMedia?.cameras[camera]?.type,
        })));
        return;
      }
      const detections = await requests.run(async () => {
        if (!isCurrent()) throw new Error('Dataset removed');
        return api.loadReviewTracks ? api.loadReviewTracks(id) : (await api.loadDetections(id)).tracks;
      });
      if (!isCurrent()) return;
      dropLoaded(id);
      const tracks = new Map<AnnotationId, TrackData>();
      detections.forEach((track) => tracks.set(track.id, track));
      const frameSource = frameSourceFor(config);
      if (config.customTypeStyling) {
        styles.populateTypeStyles({ ...styles.customStyles.value, ...config.customTypeStyling });
      }
      loaded.set(id, {
        config,
        tracks,
        hierarchy: compileHierarchy(config.typeHierarchy || {}),
        frameSource,
        pending: new Set(),
        pendingVersions: new Map(),
        deleted: new Set(),
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
      // Newly loaded tracks join the grid without any further action.
      runQuery();
    } catch (err) {
      if (!isCurrent()) return;
      patch(id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      loading.value = datasets.value.some((d) => d.status === 'loading');
    }
  }

  /**
   * Add a dataset; with `defer` it only joins the list and loads on the
   * next `loadQueued`, so picking many datasets costs nothing until the
   * results are actually wanted.
   */
  async function addDataset(id: string, summary?: ScoringDatasetSummary, options: { defer?: boolean } = {}) {
    if (disposed || !id || entry(id)) return;
    datasets.value = [...datasets.value, {
      id,
      name: summary?.name || datasetName(id),
      type: summary?.type,
      status: options.defer ? 'queued' : 'loading',
      trackCount: 0,
      croppable: false,
    }];
    if (options.defer) return;
    await load(id);
  }

  /** Load every queued dataset; annotations are read and the query rerun as each arrives. */
  async function loadQueued() {
    const queued = datasets.value.filter((d) => d.status === 'queued').map((d) => d.id);
    queued.forEach((id) => patch(id, { status: 'loading' }));
    await Promise.all(queued.map((id) => load(id)));
  }

  async function addDatasets(ids: string[]) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    await Promise.all(unique.map((id) => addDataset(id)));
  }

  function removeDataset(id: string) {
    datasets.value = datasets.value.filter((d) => d.id !== id);
    dropLoaded(id);
    loadTokens.delete(id);
    dataRevision.value += 1;
    runQuery();
  }

  async function reloadDataset(id: string) {
    if (!entry(id)) return;
    patch(id, { status: 'loading', error: undefined });
    await load(id);
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

  /** Types the query can ask for: present on the selected datasets at the current threshold. */
  const types = computed(() => {
    dependOnData();
    return collectTypes(allTracks(), query.threshold);
  });

  /** Every type on the selected datasets, offered when assigning a type. */
  const knownTypes = computed(() => {
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
    // A matching camera selects the logical track. Include every other camera
    // of that track, even when its label/confidence/attributes do not match.
    const matched = new Map<string, Set<AnnotationId>>();
    built.forEach((item) => {
      const parent = memberships.get(item.datasetId)?.parent;
      if (!parent) return;
      if (!matched.has(parent)) matched.set(parent, new Set());
      matched.get(parent)!.add(item.trackId);
    });
    const included = new Set(built.map((item) => `${item.datasetId}#${item.trackId}`));
    loaded.forEach((dataset, id) => {
      const parent = memberships.get(id)?.parent;
      const trackIds = parent ? matched.get(parent) : undefined;
      if (!trackIds) return;
      const cameras = buildReviewItems(id, dataset.tracks.values(), {
        ...DEFAULT_REVIEW_QUERY, mode: 'type', type: '', threshold: 0,
      }, grid.maxSequenceFrames);
      cameras.forEach((item) => {
        if (trackIds.has(item.trackId) && !included.has(`${id}#${item.trackId}`)) built.push(item);
      });
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

  function parentOf(id: string) {
    return memberships.get(id)?.parent ?? id;
  }

  const entries = computed(() => {
    dependOnData();
    return groupReviewItems(
      items.value,
      (datasetId) => memberships.get(datasetId),
      (item) => trackOf(item.datasetId, item.trackId),
      grid.maxSequenceFrames,
    );
  });

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

  function colorFor(type: string) {
    return styles.typeStyling.value.color(type);
  }

  function datasetFps(id: string) {
    const fps = Number(loaded.get(id)?.config.fps);
    return Number.isFinite(fps) && fps > 0 ? fps : 0;
  }

  function isPending(item: ReviewItem) {
    return loaded.get(item.datasetId)?.pending.has(item.trackId) ?? false;
  }

  const pendingCount = computed(() => {
    dependOnData();
    let count = 0;
    loaded.forEach((dataset) => { count += dataset.pending.size + dataset.deleted.size; });
    return count;
  });

  /** Mark a track dirty and bump its edit version so in-flight saves cannot clear it. */
  function markPending(dataset: LoadedDataset, trackId: AnnotationId) {
    dataset.pending.add(trackId);
    dataset.pendingVersions.set(trackId, (dataset.pendingVersions.get(trackId) ?? 0) + 1);
  }

  function updatePairs(item: ReviewItem, update: (pairs: ConfidencePair[], hierarchy: TypeHierarchyIndex) => ConfidencePair[]) {
    const dataset = loaded.get(item.datasetId);
    const track = dataset?.tracks.get(item.trackId);
    if (!dataset || !track) return;
    const next = update(track.confidencePairs.map(([t, c]) => [t, c] as ConfidencePair), dataset.hierarchy);
    track.confidencePairs = next;
    markPending(dataset, item.trackId);
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

  function deleteTrack(item: ReviewItem) {
    const dataset = loaded.get(item.datasetId);
    if (!dataset || !dataset.tracks.has(item.trackId)) return;
    dataset.tracks.delete(item.trackId);
    dataset.pending.delete(item.trackId);
    dataset.pendingVersions.delete(item.trackId);
    dataset.deleted.add(item.trackId);
    // The entry leaves the grid at once; everything else stays put.
    items.value = items.value.filter(
      (other) => !(other.datasetId === item.datasetId && other.trackId === item.trackId),
    );
    dataRevision.value += 1;
  }

  function addKeyframe(item: ReviewItem, frame: number, bounds: RectBounds) {
    const dataset = loaded.get(item.datasetId);
    const track = dataset?.tracks.get(item.trackId);
    if (!dataset || !track || track.features.some((f) => f.frame === frame && f.bounds)) return;
    const [x1, y1, x2, y2] = bounds;
    const previous = [...track.features].reverse().find((f) => f.frame < frame);
    const feature: Feature = {
      frame,
      keyframe: true,
      interpolate: previous?.interpolate ?? false,
      bounds: [
        Math.round(Math.min(x1, x2)), Math.round(Math.min(y1, y2)),
        Math.round(Math.max(x1, x2)), Math.round(Math.max(y1, y2)),
      ],
    };
    track.features = [...track.features.filter((f) => f.frame !== frame), feature]
      .sort((a, b) => a.frame - b.frame);
    track.begin = Math.min(track.begin, frame);
    track.end = Math.max(track.end, frame);
    markPending(dataset, item.trackId);
    dataRevision.value += 1;
  }

  function updateGeometry(item: ReviewItem, frame: number, edit: ReviewGeometryEdit) {
    const dataset = loaded.get(item.datasetId);
    const track = dataset?.tracks.get(item.trackId);
    const feature = track?.features.find((f) => f.frame === frame);
    if (!dataset || !track || !feature) return;

    if (edit.bounds) {
      const [x1, y1, x2, y2] = edit.bounds;
      feature.bounds = [
        Math.round(Math.min(x1, x2)), Math.round(Math.min(y1, y2)),
        Math.round(Math.max(x1, x2)), Math.round(Math.max(y1, y2)),
      ];
    }
    if (edit.head !== undefined) setKeypoint(feature, 'head', edit.head);
    if (edit.tail !== undefined) setKeypoint(feature, 'tail', edit.tail);
    if (edit.head !== undefined || edit.tail !== undefined) syncHeadTailLine(feature);
    if (edit.polygons) setPolygons(feature, edit.polygons);

    // The grid item mirrors the keyframe; refresh it so overlays and the
    // re-rendered chip follow the edit.
    const refreshed = frameRefFor(feature);
    if (refreshed) {
      item.frames.forEach((ref) => {
        if (ref.frame === frame) Object.assign(ref, refreshed);
      });
      if (item.primary.frame === frame) Object.assign(item.primary, refreshed);
    }
    markPending(dataset, item.trackId);
    dataRevision.value += 1;
    // The chip keeps its crop: the box is drawn over it, so the view does
    // not jump when an edit lands.
  }

  async function save() {
    if (saving.value) return;
    saving.value = true;
    error.value = null;
    try {
      const targets = Array.from(loaded.entries())
        .filter(([, d]) => d.pending.size > 0 || d.deleted.size > 0);
      // Snapshot payloads and versions before awaiting so mid-flight edits
      // neither mutate what we send nor get cleared on success.
      const results = await Promise.allSettled(targets.map(async ([id, dataset]) => {
        const submittedVersions = new Map<AnnotationId, number>();
        const upsert: TrackData[] = [];
        dataset.pending.forEach((trackId) => {
          const track = dataset.tracks.get(trackId);
          if (!track) return;
          submittedVersions.set(trackId, dataset.pendingVersions.get(trackId) ?? 0);
          upsert.push(JSON.parse(JSON.stringify(track)) as TrackData);
        });
        const submittedDeleted = Array.from(dataset.deleted);
        await requests.run(() => api.saveDetections(id, {
          tracks: { upsert, delete: submittedDeleted },
          groups: { upsert: [], delete: [] },
        }));
        submittedVersions.forEach((version, trackId) => {
          if (dataset.pendingVersions.get(trackId) === version) {
            dataset.pending.delete(trackId);
            dataset.pendingVersions.delete(trackId);
          }
        });
        submittedDeleted.forEach((trackId) => {
          dataset.deleted.delete(trackId);
        });
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
    const dirty = Array.from(loaded.entries())
      .filter(([, d]) => d.pending.size > 0 || d.deleted.size > 0).map(([id]) => id);
    await Promise.all(dirty.map((id) => reloadDataset(id)));
    const discarded = dirty.every((id) => !loaded.get(id)?.pending.size && !loaded.get(id)?.deleted.size);
    if (!discarded) error.value = 'Could not discard all changes. Retry when the datasets are available.';
    return discarded;
  }

  /** Reload clean snapshots before the resumed page can edit them. */
  async function refreshOnResume() {
    if (pendingCount.value > 0 || saving.value) {
      error.value = 'Save or discard pending changes before refreshing the review session.';
      return false;
    }
    const ids = datasets.value.filter((dataset) => dataset.status !== 'queued').map((dataset) => dataset.id);
    ids.forEach((id) => dropLoaded(id));
    chipStore.reset();
    dataRevision.value += 1;
    runQuery();
    await Promise.all(ids.map((id) => reloadDataset(id)));
    return ids.every((id) => entry(id)?.status === 'ready');
  }

  function clearError() {
    error.value = null;
  }

  function dispose() {
    disposed = true;
    requests.dispose();
    runQuerySettled.cancel();
    loadTokens.clear();
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
    entries,
    dataRevision,
    stale,
    types,
    knownTypes,
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
    loadQueued,
    removeDataset,
    reloadDataset,
    runQuery,
    trackOf,
    currentType,
    colorFor,
    datasetFps,
    parentOf,
    addKeyframe,
    deleteTrack,
    isPending,
    assignType,
    acceptType,
    updateGeometry,
    save,
    discardChanges,
    refreshOnResume,
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
