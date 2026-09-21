import Track from 'vue-media-annotator/track';
import { headTailFeatures } from 'vue-media-annotator/headTail';
import {
  autoPopulatePrompt, autoPopulateTarget, boundsIoU, closedRing, polygonBounds, orientLineLike, LINE_PROMPT_FRACTIONS,
} from './autoPopulate';

it('prompts a box with its centre', () => {
  expect(autoPopulatePrompt({ source: 'box', bounds: [10, 20, 30, 60] })).toEqual({ points: [[20, 40]], labels: [1] });
  expect(autoPopulatePrompt({ source: 'mask', polygons: [] })).toEqual({ points: [], labels: [] });
});

it('prompts a line with foreground points spread along its length', () => {
  const { points, labels } = autoPopulatePrompt({ source: 'line', line: [[0, 0], [100, 0]] });
  expect(points).toEqual(LINE_PROMPT_FRACTIONS.map((f) => [100 * f, 0]));
  expect(labels).toEqual([1, 1, 1, 1, 1]);
  // Multi-vertex lines measure along the path, not the chord.
  const bent = autoPopulatePrompt({ source: 'line', line: [[0, 0], [50, 0], [50, 50]] });
  expect(bent.points[2]).toEqual([50, 0]);
  expect(bent.points[4]).toEqual([50, 40]);
});

it('closes rings and measures polygon bounds', () => {
  expect(closedRing([[0, 0], [4, 0], [4, 3]])).toEqual([[0, 0], [4, 0], [4, 3], [0, 0]]);
  expect(closedRing([[0, 0], [4, 0], [0, 0]])).toHaveLength(3);
  expect(polygonBounds([[1, 5], [4, 2], [3, 9]])).toEqual([1, 2, 4, 9]);
});

it('measures the overlap of two boxes', () => {
  expect(boundsIoU([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
  expect(boundsIoU([0, 0, 10, 10], [5, 0, 15, 10])).toBeCloseTo(1 / 3);
  expect(boundsIoU([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0);
  expect(boundsIoU([0, 0, 0, 0], [0, 0, 0, 0])).toBe(0);
});

it('flips a head/tail pair that runs against the other camera\'s line', () => {
  expect(orientLineLike([[90, 10], [10, 12]], [[0, 0], [100, 0]])).toEqual([[10, 12], [90, 10]]);
  expect(orientLineLike([[10, 12], [90, 10]], [[0, 0], [100, 0]])).toEqual([[10, 12], [90, 10]]);
});

it('rejects a late result after the user changes the box or draws a line', async () => {
  const track = new Track(1, {
    features: [{ frame: 0, keyframe: true, bounds: [0, 0, 10, 10] }],
  });
  const current = autoPopulateTarget(() => track, 0);
  expect(current()?.track).toBe(track);
  // Stand in for a pending service response, with a manual edit in between.
  const result = Promise.resolve().then(() => current());
  track.setFeature({ frame: 0, bounds: [20, 20, 30, 30] }, headTailFeatures([[21, 21], [29, 29]]));
  expect(await result).toBeNull();
});

it('rejects removal or replacement of the target but allows metadata updates', () => {
  const feature = { frame: 0, keyframe: true, bounds: [0, 0, 10, 10] as [number, number, number, number] };
  let track: Track | undefined = new Track(1, { features: [feature] });
  const current = autoPopulateTarget(() => track, 0);
  track.setFeatureAttribute(0, 'stereo_user_line', true);
  expect(current()?.track).toBe(track);
  track = new Track(1, { features: [feature] });
  expect(current()).toBeNull();
  track = undefined;
  expect(current()).toBeNull();
});
