/**
 * Search results as annotations of their datasets. Editing a result's
 * type or box, or accepting it, gives it a track of its own in the review
 * service (never touching the annotations already there). Saving then
 * decides what is written: accepted results and results given a type
 * (rejected ones only with a type), and where those overlap annotations
 * the dataset already has, the caller is asked whether to keep the
 * originals, replace the overlapped ones, replace every original, or
 * drop the results altogether.
 */
import {
  computed, effectScope, ref, watch,
} from 'vue';
import type { VideoSearchResult } from 'dive-common/apispec';
import type { ReviewCellGeometryEdit } from 'dive-common/components/Review/ReviewCell.vue';
import { tracksOverlapping } from 'dive-common/review/reviewItems';
import { searchResultTrack } from 'dive-common/review/searchResultItems';
import type { ReviewItem } from 'dive-common/review/types';
import type { ReviewService } from 'dive-common/use/useReview';
import type { VideoSearchContextType } from 'platform/desktop/frontend/useVideoSearch';

/** Type of a result saved or box-edited without one; not counted as an assigned type. */
export const UNTYPED_RESULT = 'unknown';

/** Overlap at which a result counts as the same object as an existing annotation. */
const OVERLAP_MIN_IOU = 0.5;

export type OverlapChoice = 'keep-originals' | 'overwrite-overlapping' | 'overwrite-all' | 'discard';

export interface OverlapSummary {
  /** Results to save that overlap an existing annotation. */
  overlapping: number;
  /** Results to save in total. */
  total: number;
  /** Datasets those results belong to. */
  datasetIds: string[];
}

export interface SearchReviewOptions {
  /** How to save results that overlap existing annotations. */
  resolveOverlap: (summary: OverlapSummary) => Promise<OverlapChoice>;
}

interface CreatedTrack {
  datasetId: string;
  trackId: number;
}

export type SearchSaveOutcome = 'saved' | 'nothing' | 'discarded' | 'failed';

/**
 * Detached like createReviewService: the Query page parks this across viewer
 * visits, so changeCount/hasChanges must keep updating after that unmount.
 */
export function createSearchReview(
  search: VideoSearchContextType,
  review: ReviewService,
  options: SearchReviewOptions,
) {
  const scope = effectScope(true);
  const service = scope.run(() => createScopedSearchReview(search, review, options))!;
  const { dispose } = service;
  service.dispose = () => {
    dispose();
    scope.stop();
  };
  return service;
}

function createScopedSearchReview(
  search: VideoSearchContextType,
  review: ReviewService,
  options: SearchReviewOptions,
) {
  /** Results with a track of their own, as the review items backing their cells. */
  const adopted = ref<Record<string, ReviewItem>>({});
  /** The track each adopted result created (saved or not). */
  const created = ref<Record<string, CreatedTrack>>({});
  /** Results whose track has been written to its dataset. */
  const saved = ref<Record<string, true>>({});
  /** Results whose box was adjusted. */
  const edited = ref<Record<string, true>>({});
  /** Results taken out of the grid. */
  const removed = ref<Record<string, true>>({});
  const error = ref<string | null>(null);
  const adopting = new Map<string, Promise<ReviewItem>>();

  function without<T>(record: Record<string, T>, ref: string): Record<string, T> {
    const rest = { ...record };
    delete rest[ref];
    return rest;
  }

  function discardEntry(ref: string) {
    const track = created.value[ref];
    if (track && !saved.value[ref]) review.discardTrack(track.datasetId, track.trackId);
    adopted.value = without(adopted.value, ref);
    created.value = without(created.value, ref);
    edited.value = without(edited.value, ref);
  }

  // Refs are only unique within one query, so a new query starts over;
  // tracks not yet saved are dropped with it.
  watch(() => search.state.queryGeneration, () => {
    Object.keys(created.value).forEach((ref) => {
      const track = created.value[ref];
      if (!saved.value[ref]) review.discardTrack(track.datasetId, track.trackId);
    });
    adopted.value = {};
    created.value = {};
    saved.value = {};
    edited.value = {};
    removed.value = {};
    adopting.clear();
  });

  function itemOf(result: VideoSearchResult): ReviewItem | undefined {
    return adopted.value[result.ref];
  }

  function isRemoved(result: VideoSearchResult): boolean {
    return removed.value[result.ref] === true;
  }

  async function doAdopt(result: VideoSearchResult, type: string): Promise<ReviewItem> {
    const datasetId = search.resultDatasetId(result);
    if (!datasetId) throw new Error('This result belongs to a dataset that is no longer in the index');
    if (!await review.ensureLoaded(datasetId)) {
      throw new Error(`Could not load the annotations of ${datasetId}`);
    }
    const data = searchResultTrack(result, type);
    if (!data) throw new Error('This result has no box to annotate');
    const track = review.insertTrack(datasetId, data);
    if (!track) throw new Error(`Could not add the annotation to ${datasetId}`);
    const item = review.itemFor(datasetId, track.id, result.ref);
    if (!item) throw new Error('This annotation has no box to show');
    adopted.value = { ...adopted.value, [result.ref]: item };
    created.value = { ...created.value, [result.ref]: { datasetId, trackId: track.id } };
    return item;
  }

  /** The review item behind a result, giving it a track of its own first when needed. */
  function adopt(result: VideoSearchResult, type = UNTYPED_RESULT): Promise<ReviewItem> {
    const existing = adopted.value[result.ref];
    if (existing) return Promise.resolve(existing);
    let pending = adopting.get(result.ref);
    if (!pending) {
      pending = doAdopt(result, type).finally(() => { adopting.delete(result.ref); });
      adopting.set(result.ref, pending);
    }
    return pending;
  }

  async function guarded<T>(op: () => Promise<T>): Promise<T | undefined> {
    error.value = null;
    try {
      return await op();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      return undefined;
    }
  }

  function assignType(result: VideoSearchResult, type: string) {
    const trimmed = type.trim();
    if (!trimmed) return Promise.resolve(undefined);
    return guarded(async () => {
      const item = await adopt(result, trimmed);
      if (review.currentType(item).type !== trimmed) review.assignType(item, trimmed);
    });
  }

  function editGeometry(result: VideoSearchResult, edit: ReviewCellGeometryEdit) {
    return guarded(async () => {
      const item = await adopt(result);
      review.updateGeometry(item, edit.frame, {
        bounds: edit.bounds ?? undefined,
        polygons: edit.polygons,
        head: edit.head,
        tail: edit.tail,
      });
      edited.value = { ...edited.value, [result.ref]: true };
    });
  }

  /** Drop a result from the grid; a saved one is also deleted from its dataset on save. */
  function remove(result: VideoSearchResult) {
    const item = adopted.value[result.ref];
    if (item && saved.value[result.ref]) review.deleteTrack(item);
    discardEntry(result.ref);
    removed.value = { ...removed.value, [result.ref]: true };
  }

  function assignedType(item: ReviewItem): string {
    const { type } = review.currentType(item);
    return type === UNTYPED_RESULT ? '' : type;
  }

  /**
   * Whether an adopted result is worth writing: accepted ones always,
   * rejected ones only with a type, the rest when typed or box-edited.
   */
  function qualifies(result: VideoSearchResult, item: ReviewItem): boolean {
    const adjudication = search.state.adjudications[result.ref];
    if (adjudication === 'positive') return true;
    const typed = assignedType(item) !== '';
    if (adjudication === 'negative') return typed;
    return typed || edited.value[result.ref] === true;
  }

  /** Results the next save would write or update, for the toolbar. */
  const changeCount = computed(() => {
    review.dataRevision.value; // eslint-disable-line no-unused-expressions
    return search.state.results.filter((result) => {
      if (removed.value[result.ref]) return false;
      const item = adopted.value[result.ref];
      if (!item) return search.state.adjudications[result.ref] === 'positive';
      if (saved.value[result.ref]) return review.isPending(item);
      return qualifies(result, item);
    }).length;
  });

  const hasChanges = computed(() => changeCount.value > 0 || review.pendingCount.value > 0);

  /** Track ids this session created in a dataset; the rest are the dataset's own. */
  function createdIn(datasetId: string): Set<number> {
    const ids = new Set<number>();
    Object.values(created.value).forEach((track) => {
      if (track.datasetId === datasetId) ids.add(track.trackId);
    });
    return ids;
  }

  function originalsOf(datasetId: string) {
    const mine = createdIn(datasetId);
    return review.tracksOf(datasetId).filter((track) => !mine.has(track.id));
  }

  function save(): Promise<SearchSaveOutcome> {
    return guarded(async (): Promise<SearchSaveOutcome> => {
      const results = search.state.results.filter((result) => !removed.value[result.ref]);
      // Accepted results without a track get one now.
      await Promise.all(results
        .filter((result) => search.state.adjudications[result.ref] === 'positive' && !adopted.value[result.ref])
        .map((result) => adopt(result)));

      const unsaved = results.filter((result) => adopted.value[result.ref] && !saved.value[result.ref]);
      const keep = unsaved.filter((result) => qualifies(result, adopted.value[result.ref]));
      unsaved.filter((result) => !keep.includes(result)).forEach((result) => discardEntry(result.ref));

      const overlaps = new Map<string, { datasetId: string; tracks: number[] }>();
      keep.forEach((result) => {
        const { datasetId, trackId } = created.value[result.ref];
        const track = review.trackOf(datasetId, trackId);
        if (!track) return;
        const hits = tracksOverlapping(originalsOf(datasetId), track, OVERLAP_MIN_IOU);
        if (hits.length) overlaps.set(result.ref, { datasetId, tracks: hits.map((hit) => hit.id) });
      });
      if (overlaps.size > 0) {
        const choice = await options.resolveOverlap({
          overlapping: overlaps.size,
          total: keep.length,
          datasetIds: Array.from(new Set(keep.map((result) => created.value[result.ref].datasetId))),
        });
        if (choice === 'discard') {
          keep.forEach((result) => discardEntry(result.ref));
          return 'discarded';
        }
        if (choice === 'keep-originals') {
          overlaps.forEach((_hit, ref) => discardEntry(ref));
        } else if (choice === 'overwrite-overlapping') {
          overlaps.forEach(({ datasetId, tracks }) => {
            tracks.forEach((trackId) => review.deleteTrackById(datasetId, trackId));
          });
        } else if (choice === 'overwrite-all') {
          new Set(keep.map((result) => created.value[result.ref].datasetId)).forEach((datasetId) => {
            originalsOf(datasetId).forEach((track) => review.deleteTrackById(datasetId, track.id));
          });
        }
      }

      if (review.pendingCount.value === 0) return 'nothing';
      await review.save();
      if (review.pendingCount.value > 0) return 'failed';
      const written: Record<string, true> = { ...saved.value };
      keep.forEach((result) => { if (created.value[result.ref]) written[result.ref] = true; });
      saved.value = written;
      // Edits covered by this save no longer count as pending changes.
      edited.value = Object.fromEntries(
        Object.entries(edited.value).filter(([ref]) => !written[ref]),
      );
      return 'saved';
    }).then((outcome) => outcome ?? 'failed');
  }

  /** Drop every unsaved result track and any edits to saved ones. */
  async function discardAll() {
    Object.keys(created.value).forEach((ref) => {
      if (!saved.value[ref]) discardEntry(ref);
    });
    if (review.pendingCount.value > 0) await review.discardChanges();
  }

  function clearError() {
    error.value = null;
  }

  function dispose() {
    adopting.clear();
  }

  return {
    adopted,
    error,
    changeCount,
    hasChanges,
    itemOf,
    isRemoved,
    adopt,
    assignType,
    editGeometry,
    remove,
    save,
    discardAll,
    clearError,
    dispose,
  };
}

export type SearchReview = ReturnType<typeof createSearchReview>;
