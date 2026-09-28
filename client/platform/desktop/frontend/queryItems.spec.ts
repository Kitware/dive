import { textHitItem, textQueryFrames, textQueryHits } from './queryItems';

describe('textQueryFrames', () => {
  it('walks a known length at the stride and thins evenly past the cap', () => {
    expect(textQueryFrames(10, 3, 100)).toEqual([0, 3, 6, 9]);
    expect(textQueryFrames(100, 1, 5)).toEqual([0, 25, 50, 74, 99]);
    expect(textQueryFrames(0, 1, 5)).toEqual([]);
  });

  it('takes the first frames at the stride when the length is unknown', () => {
    expect(textQueryFrames(null, 10, 3)).toEqual([0, 10, 20]);
  });
});

describe('text query hits', () => {
  it('turns detections into keyed hits and single-frame grid items', () => {
    const hits = textQueryHits('ds', 7, '/frames/7.png', [
      {
        box: [1, 2, 3, 4], score: 0.9, label: 'fish', polygon: [[1, 2], [3, 2], [3, 4]],
      },
      {
        box: [5, 6, 7, 8], score: 0.4, label: 'fish', polygon: [[1, 2]],
      },
    ]);
    expect(hits.map((h) => h.key)).toEqual(['text:ds#7#0', 'text:ds#7#1']);
    expect(hits[1].polygon).toBeUndefined();
    const item = textHitItem(hits[0]);
    expect(item).toMatchObject({
      key: 'text:ds#7#0', datasetId: 'ds', type: 'fish', confidence: 0.9,
    });
    expect(item.primary).toEqual({ frame: 7, bounds: [1, 2, 3, 4], polygons: [[[1, 2], [3, 2], [3, 4]]] });
    expect(item.frames).toHaveLength(1);
  });
});
