import { reactive, ref } from 'vue';
import type { VideoSearchResult } from 'dive-common/apispec';
import type { ReviewItem } from 'dive-common/review/types';
import type { ReviewService } from 'dive-common/use/useReview';
import type { VideoSearchContextType } from './useVideoSearch';
import { createSearchReview } from './useSearchReview';

function result(ref: string, states: { frame: number; bbox?: [number, number, number, number] }[]): VideoSearchResult {
  return {
    ref,
    session: 0,
    index_dir: '',
    instance_id: 1,
    query_id: 'q',
    stream_id: 'left',
    relevancy_score: 0.5,
    start_frame: states[0]?.frame ?? null,
    end_frame: states[states.length - 1]?.frame ?? null,
    tracks: [{ id: 9, states }],
  };
}

function item(trackId: number, key: string): ReviewItem {
  return {
    key, datasetId: 'ds', trackId, primary: { frame: 0, bounds: [0, 0, 1, 1] }, frames: [], keyframeCount: 1, type: 'fish', confidence: 1,
  };
}

function setup(existingTrackId?: number) {
  const search = {
    state: reactive({ queryGeneration: 1 }),
    resultDatasetId: vi.fn(() => 'ds'),
  } as unknown as VideoSearchContextType;
  const review = {
    ensureLoaded: vi.fn(async () => true),
    findTrackAt: vi.fn(() => (existingTrackId === undefined ? undefined : { id: existingTrackId })),
    insertTrack: vi.fn((_id: string, track: { confidencePairs: [string, number][] }) => ({ id: 42, ...track })),
    itemFor: vi.fn((_id: string, trackId: number, key: string) => item(trackId, key)),
    currentType: vi.fn((adopted: ReviewItem) => ({ type: adopted.trackId === 42 ? 'crab' : 'fish', confidence: 1 })),
    assignType: vi.fn(),
    updateGeometry: vi.fn(),
    deleteTrack: vi.fn(),
  } as unknown as ReviewService;
  return { search, review, searchReview: createSearchReview(search, review) };
}

describe('createSearchReview', () => {
  it('links a result to the annotation its box overlaps and revises that type', async () => {
    const { review, searchReview } = setup(7);
    await searchReview.assignType(result('0:1', [{ frame: 3, bbox: [0, 0, 10, 10] }]), 'crab');
    expect(review.findTrackAt).toHaveBeenCalledWith('ds', 3, [0, 0, 10, 10], 0.5);
    expect(review.insertTrack).not.toHaveBeenCalled();
    expect(review.assignType).toHaveBeenCalledWith(expect.objectContaining({ trackId: 7, key: '0:1' }), 'crab');
    expect(searchReview.itemOf(result('0:1', []))?.trackId).toBe(7);
  });

  it('inserts a new track under the typed type when nothing overlaps, once per result', async () => {
    const { review, searchReview } = setup();
    const hit = result('0:2', [{ frame: 3, bbox: [0, 0, 10, 10] }]);
    await Promise.all([searchReview.assignType(hit, 'crab'), searchReview.editGeometry(hit, {
      slot: 0, frame: 3, bounds: [1, 1, 9, 9], polygons: [], head: null, tail: null,
    })]);
    expect(review.insertTrack).toHaveBeenCalledTimes(1);
    expect(review.insertTrack).toHaveBeenCalledWith('ds', expect.objectContaining({ confidencePairs: [['crab', 1]] }));
    expect(review.assignType).not.toHaveBeenCalled();
    expect(review.updateGeometry).toHaveBeenCalledWith(expect.objectContaining({ trackId: 42 }), 3, expect.objectContaining({ bounds: [1, 1, 9, 9] }));
  });

  it('reports results that cannot become annotations instead of throwing', async () => {
    const { review, searchReview } = setup();
    await searchReview.editGeometry(result('0:3', [{ frame: 3 }]), {
      slot: 0, frame: 3, bounds: [1, 1, 9, 9], polygons: [], head: null, tail: null,
    });
    expect(review.updateGeometry).not.toHaveBeenCalled();
    expect(searchReview.error.value).toMatch(/no box/);
  });

  it('removes adopted results from their dataset and forgets everything on a new query', async () => {
    const { search, review, searchReview } = setup(7);
    const hit = result('0:4', [{ frame: 3, bbox: [0, 0, 10, 10] }]);
    await searchReview.assignType(hit, 'crab');
    searchReview.remove(hit);
    expect(review.deleteTrack).toHaveBeenCalledWith(expect.objectContaining({ trackId: 7 }));
    expect(searchReview.isRemoved(hit)).toBe(true);
    search.state.queryGeneration += 1;
    await ref(0); // let watchers flush
    await Promise.resolve();
    expect(searchReview.isRemoved(hit)).toBe(false);
    expect(searchReview.itemOf(hit)).toBeUndefined();
  });
});
