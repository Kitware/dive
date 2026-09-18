import {
  autoPopulatePrompt, closedRing, polygonBounds, LINE_PROMPT_FRACTIONS,
} from './autoPopulate';

it('prompts a box with its centre', () => {
  expect(autoPopulatePrompt({ source: 'box', bounds: [10, 20, 30, 60] })).toEqual({ points: [[20, 40]], labels: [1] });
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
