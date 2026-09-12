import type { VideoSearchResult } from 'dive-common/apispec';
import { sampleSearchStates, searchResultFrame, searchResultItem } from './searchResultItems';

function result(states: { frame: number; bbox?: [number, number, number, number] }[], extra: Partial<VideoSearchResult> = {}): VideoSearchResult {
  return {
    ref: '0:7',
    session: 0,
    index_dir: '',
    instance_id: 7,
    query_id: 'q',
    stream_id: 's',
    relevancy_score: 0.42,
    start_frame: states[0]?.frame ?? null,
    end_frame: states[states.length - 1]?.frame ?? null,
    tracks: states.length ? [{ id: 3, states }] : [],
    ...extra,
  };
}

describe('searchResultItem', () => {
  it('maps a track result to an item keyed by ref with sampled frames', () => {
    const states = Array.from({ length: 20 }, (_, i) => ({ frame: i * 2, bbox: [i, 0, i + 5, 5] as [number, number, number, number] }));
    const item = searchResultItem(result(states), 'ds', 4);
    expect(item).toMatchObject({
      key: '0:7', datasetId: 'ds', trackId: 3, confidence: 0.42, keyframeCount: 20, type: '',
    });
    expect(item?.frames.map((f) => f.frame)).toEqual([0, 12, 26, 38]);
    expect(item?.primary).toEqual({ frame: 0, bounds: [0, 0, 5, 5] });
  });

  it('shows the whole frame when a state has no box', () => {
    const item = searchResultItem(result([{ frame: 9 }]), 'ds', 8);
    expect(item?.frames).toEqual([{ frame: 9, bounds: null }]);
  });

  it('falls back to start_frame for results without tracks, and drops frameless ones', () => {
    expect(searchResultItem(result([], { start_frame: 4 }), 'ds', 8)).toMatchObject({
      trackId: 7, primary: { frame: 4, bounds: null },
    });
    expect(searchResultItem(result([], { start_frame: null }), 'ds', 8)).toBeNull();
    expect(searchResultFrame(result([], { start_frame: null }))).toBeNull();
  });

  it('never repeats a frame when sampling', () => {
    expect(sampleSearchStates(result([{ frame: 1 }, { frame: 1 }, { frame: 1 }]), 8)).toHaveLength(1);
  });
});
