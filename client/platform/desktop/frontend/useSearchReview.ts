/**
 * Search results as editable annotations. A result is only a descriptor
 * match until it is adopted: the first type or box edit loads its dataset
 * into the review service and either links the result to the annotation
 * already there (a box on the same frame that overlaps it) or inserts a
 * new track built from the result's states. From then on the review
 * service owns it: type, geometry, deletion and saving work as on Review.
 */
import { ref, watch } from 'vue';
import type { VideoSearchResult } from 'dive-common/apispec';
import type { ReviewCellGeometryEdit } from 'dive-common/components/Review/ReviewCell.vue';
import { searchResultTrack } from 'dive-common/review/searchResultItems';
import type { ReviewItem } from 'dive-common/review/types';
import type { ReviewService } from 'dive-common/use/useReview';
import type { VideoSearchContextType } from 'platform/desktop/frontend/useVideoSearch';

/** Type given to a result adopted through a box edit, before any type is typed in. */
export const UNTYPED_RESULT = 'unknown';

/** Overlap needed for a result to count as an existing annotation. */
const LINK_MIN_IOU = 0.5;

export function createSearchReview(search: VideoSearchContextType, review: ReviewService) {
  /** Adopted results by ref, as the review items now backing their cells. */
  const adopted = ref<Record<string, ReviewItem>>({});
  /** Results deleted from the grid (and, when adopted, from their dataset). */
  const removed = ref<Record<string, true>>({});
  const error = ref<string | null>(null);
  const adopting = new Map<string, Promise<ReviewItem>>();

  // Refs are only unique within one query, so a new query starts over.
  watch(() => search.state.queryGeneration, () => {
    adopted.value = {};
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
    const primary = result.tracks[0]?.states[0];
    let track = primary?.bbox ? review.findTrackAt(datasetId, primary.frame, primary.bbox, LINK_MIN_IOU) : undefined;
    if (!track) {
      const data = searchResultTrack(result, type);
      if (!data) throw new Error('This result has no box to annotate');
      track = review.insertTrack(datasetId, data);
    }
    if (!track) throw new Error(`Could not add the annotation to ${datasetId}`);
    const item = review.itemFor(datasetId, track.id, result.ref);
    if (!item) throw new Error('This annotation has no box to show');
    adopted.value = { ...adopted.value, [result.ref]: item };
    return item;
  }

  /** The review item behind a result, adopting it into its dataset first when needed. */
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
    });
  }

  /** Drop a result from the grid; an adopted one is also deleted from its dataset on save. */
  function remove(result: VideoSearchResult) {
    const item = adopted.value[result.ref];
    if (item) review.deleteTrack(item);
    removed.value = { ...removed.value, [result.ref]: true };
  }

  function clearError() {
    error.value = null;
  }

  return {
    adopted,
    error,
    itemOf,
    isRemoved,
    adopt,
    assignType,
    editGeometry,
    remove,
    clearError,
  };
}

export type SearchReview = ReturnType<typeof createSearchReview>;
