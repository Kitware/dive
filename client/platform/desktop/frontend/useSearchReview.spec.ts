import { effectScope, reactive } from 'vue';
import type { VideoSearchResult } from 'dive-common/apispec';
import type { ReviewItem } from 'dive-common/review/types';
import type { TrackData } from 'vue-media-annotator/track';
import type { ReviewService } from 'dive-common/use/useReview';
import type { VideoSearchContextType } from './useVideoSearch';
import { createSearchReview, OverlapChoice } from './useSearchReview';

function result(ref: string, frame = 3, bbox: [number, number, number, number] = [0, 0, 10, 10]): VideoSearchResult {
  return {
    ref,
    session: 0,
    index_dir: '',
    instance_id: 1,
    query_id: 'q',
    stream_id: 'left',
    relevancy_score: 0.5,
    start_frame: frame,
    end_frame: frame,
    tracks: [{ id: 9, states: [{ frame, bbox }] }],
  };
}

function track(id: number, frame: number, bounds: [number, number, number, number], type = 'fish'): TrackData {
  return {
    id, begin: frame, end: frame, confidencePairs: [[type, 1]], attributes: {}, features: [{ frame, keyframe: true, bounds }],
  };
}

/** A minimal in-memory stand-in for the review service's track store. */
function setup(originals: TrackData[], choice: OverlapChoice = 'keep-originals') {
  const tracks = new Map(originals.map((t) => [t.id, t]));
  const pending = new Set<number>();
  const deleted = new Set<number>();
  let nextId = 100;
  const search = {
    state: reactive({ queryGeneration: 1, results: [] as VideoSearchResult[], adjudications: {} as Record<string, 'positive' | 'negative' | undefined> }),
    resultDatasetId: vi.fn(() => 'ds'),
  } as unknown as VideoSearchContextType;
  const review = {
    dataRevision: { value: 0 },
    pendingCount: { get value() { return pending.size + deleted.size; } },
    ensureLoaded: vi.fn(async () => true),
    insertTrack: vi.fn((_id: string, data: Omit<TrackData, 'id'>) => {
      const inserted = { ...data, id: nextId };
      nextId += 1;
      tracks.set(inserted.id, inserted);
      pending.add(inserted.id);
      return inserted;
    }),
    itemFor: vi.fn((_id: string, trackId: number, key: string): ReviewItem => ({
      key, datasetId: 'ds', trackId, primary: { frame: 3, bounds: [0, 0, 10, 10] }, frames: [], keyframeCount: 1, type: '', confidence: 1,
    })),
    trackOf: vi.fn((_id: string, trackId: number) => tracks.get(trackId)),
    tracksOf: vi.fn(() => Array.from(tracks.values())),
    currentType: vi.fn((item: ReviewItem) => ({ type: tracks.get(item.trackId)?.confidencePairs[0]?.[0] ?? '', confidence: 1 })),
    isPending: vi.fn((item: ReviewItem) => pending.has(item.trackId)),
    assignType: vi.fn((item: ReviewItem, type: string) => { tracks.get(item.trackId)!.confidencePairs = [[type, 1]]; pending.add(item.trackId); }),
    updateGeometry: vi.fn(),
    discardTrack: vi.fn((_id: string, trackId: number) => { tracks.delete(trackId); pending.delete(trackId); }),
    deleteTrackById: vi.fn((_id: string, trackId: number) => { tracks.delete(trackId); pending.delete(trackId); deleted.add(trackId); }),
    deleteTrack: vi.fn((item: ReviewItem) => { tracks.delete(item.trackId); pending.delete(item.trackId); deleted.add(item.trackId); }),
    save: vi.fn(async () => { pending.clear(); deleted.clear(); }),
    discardChanges: vi.fn(async () => { pending.clear(); deleted.clear(); return true; }),
  } as unknown as ReviewService;
  const resolveOverlap = vi.fn(async () => choice);
  return {
    search, review, tracks, deleted, resolveOverlap, searchReview: createSearchReview(search, review, { resolveOverlap }),
  };
}

describe('createSearchReview', () => {
  it('saves accepted results and typed rejected ones, but not untyped rejected or unmarked ones', async () => {
    const {
      search, review, tracks, searchReview,
    } = setup([]);
    const accepted = result('0:1', 1, [100, 100, 110, 110]);
    const rejectedTyped = result('0:2', 2, [200, 200, 210, 210]);
    const rejectedUntyped = result('0:3', 3, [300, 300, 310, 310]);
    const unmarked = result('0:4', 4, [400, 400, 410, 410]);
    search.state.results = [accepted, rejectedTyped, rejectedUntyped, unmarked];
    search.state.adjudications = { '0:1': 'positive', '0:2': 'negative', '0:3': 'negative' };
    await searchReview.assignType(rejectedTyped, 'crab');
    await searchReview.editGeometry(rejectedUntyped, {
      slot: 0, frame: 3, bounds: [1, 1, 9, 9], polygons: [], head: null, tail: null,
    });
    expect(searchReview.changeCount.value).toBe(2);

    expect(await searchReview.save()).toBe('saved');
    expect(review.save).toHaveBeenCalledTimes(1);
    const savedTypes = Array.from(tracks.values()).map((t) => t.confidencePairs[0][0]).sort();
    expect(savedTypes).toEqual(['crab', 'unknown']);
    expect(searchReview.itemOf(rejectedUntyped)).toBeUndefined();
    expect(searchReview.changeCount.value).toBe(0);
  });

  it('asks about overlaps and can keep the originals, replace the overlapped ones, or replace everything', async () => {
    const run = async (choice: OverlapChoice) => {
      const {
        search, review, tracks, deleted, resolveOverlap, searchReview,
      } = setup([
        track(1, 3, [0, 0, 10, 10]), track(2, 9, [50, 50, 60, 60]),
      ], choice);
      const overlapping = result('0:1');
      const clear = result('0:2', 5, [70, 70, 80, 80]);
      search.state.results = [overlapping, clear];
      search.state.adjudications = { '0:1': 'positive', '0:2': 'positive' };
      const outcome = await searchReview.save();
      expect(resolveOverlap).toHaveBeenCalledWith({ overlapping: 1, total: 2, datasetIds: ['ds'] });
      return {
        outcome, review, ids: Array.from(tracks.keys()).sort((a, b) => a - b), deleted: Array.from(deleted),
      };
    };
    const kept = await run('keep-originals');
    expect(kept.outcome).toBe('saved');
    expect(kept.ids).toEqual([1, 2, 101]);

    const replaced = await run('overwrite-overlapping');
    expect(replaced.review.deleteTrackById).toHaveBeenCalledWith('ds', 1);
    expect(replaced.ids).toEqual([2, 100, 101]);

    const all = await run('overwrite-all');
    expect(all.review.deleteTrackById).toHaveBeenCalledTimes(2);
    expect(all.ids).toEqual([100, 101]);

    const discarded = await run('discard');
    expect(discarded.outcome).toBe('discarded');
    expect(discarded.review.save).not.toHaveBeenCalled();
    expect(discarded.ids).toEqual([1, 2]);
  });

  it('drops unsaved result tracks on a new query and deletes saved ones on remove', async () => {
    const {
      search, review, tracks, searchReview,
    } = setup([]);
    const first = result('0:1');
    search.state.results = [first];
    search.state.adjudications = { '0:1': 'positive' };
    await searchReview.save();
    expect(tracks.size).toBe(1);
    searchReview.remove(first);
    expect(review.deleteTrack).toHaveBeenCalledTimes(1);
    expect(searchReview.isRemoved(first)).toBe(true);

    const second = result('0:2');
    search.state.results = [second];
    await searchReview.assignType(second, 'crab');
    expect(tracks.size).toBe(1);
    search.state.queryGeneration += 1;
    await Promise.resolve();
    expect(review.discardTrack).toHaveBeenCalledWith('ds', 101);
    expect(searchReview.itemOf(second)).toBeUndefined();
  });

  it('adopts a whole-frame result when a box is drawn on it', async () => {
    const { review, searchReview } = setup([]);
    const boxless = { ...result('0:3'), tracks: [{ id: 9, states: [{ frame: 3 }] }] };
    await searchReview.editGeometry(boxless, {
      slot: 0, frame: 3, bounds: [1, 1, 9, 9], polygons: [], head: null, tail: null,
    });
    expect(review.insertTrack).toHaveBeenCalled();
    expect(review.updateGeometry).toHaveBeenCalled();
    expect(searchReview.error.value).toBeNull();
  });

  it('saves accepted whole-frame results that have no box', async () => {
    const {
      search, review, tracks, searchReview,
    } = setup([]);
    const boxless = { ...result('0:3'), tracks: [{ id: 9, states: [{ frame: 3 }] }] };
    search.state.results = [boxless];
    search.state.adjudications = { '0:3': 'positive' };
    expect(searchReview.changeCount.value).toBe(1);
    expect(await searchReview.save()).toBe('saved');
    expect(review.insertTrack).toHaveBeenCalled();
    expect(tracks.size).toBe(1);
    expect(searchReview.changeCount.value).toBe(0);
  });

  it('re-enables save after a successful save when more results are accepted or typed', async () => {
    const { search, searchReview } = setup([]);
    const first = result('0:1', 1, [0, 0, 10, 10]);
    const second = result('0:2', 2, [20, 20, 30, 30]);
    const third = result('0:3', 3, [40, 40, 50, 50]);
    search.state.results = [first, second, third];
    search.state.adjudications = { '0:1': 'positive' };
    expect(await searchReview.save()).toBe('saved');
    expect(searchReview.hasChanges.value).toBe(false);

    search.state.adjudications = { ...search.state.adjudications, '0:2': 'positive' };
    expect(searchReview.changeCount.value).toBe(1);
    expect(searchReview.hasChanges.value).toBe(true);

    await searchReview.assignType(third, 'fish');
    expect(searchReview.changeCount.value).toBe(2);
  });

  it('keeps hasChanges live after the creating component scope stops', async () => {
    // Query parks searchReview across viewer visits; the page unmount stops its
    // own scope, so createSearchReview must use a detached scope.
    const pageScope = effectScope();
    const ctx = pageScope.run(() => setup([]))!;
    const { search, searchReview } = ctx;
    const first = result('0:1');
    const second = result('0:2', 2, [20, 20, 30, 30]);
    search.state.results = [first, second];
    search.state.adjudications = { '0:1': 'positive' };
    expect(await searchReview.save()).toBe('saved');
    expect(searchReview.hasChanges.value).toBe(false);

    pageScope.stop();
    search.state.adjudications = { ...search.state.adjudications, '0:2': 'positive' };
    expect(searchReview.hasChanges.value).toBe(true);
  });
});
