import Track from 'vue-media-annotator/track';
import type { SegmentationPredictResponse } from 'dive-common/apispec';
import SegmentationPointClick, { MultiFrameSegmentationResult, SegmentationPredictionResult } from './segmentationpointclick';

const components = [
  { exterior: [[0, 0], [10, 0], [10, 10]] as [number, number][], holes: [[[2, 2], [4, 2], [4, 4]] as [number, number][]] },
  { exterior: [[20, 0], [30, 0], [30, 10]] as [number, number][], holes: [] },
];

const click = (x: number, y: number): GeoJSON.Feature<GeoJSON.Point> => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: {},
});

async function predicted(recipe: SegmentationPointClick, track: Track, x: number) {
  const ready = new Promise<SegmentationPredictionResult>((resolve) => recipe.bus.$once('prediction-ready', resolve));
  recipe.update('editing', 0, track, [click(x, 5)]);
  return ready;
}

function harness() {
  const recipe = new SegmentationPointClick();
  const predict = vi.fn(async (): Promise<SegmentationPredictResponse> => ({
    success: true, polygon: components[0].exterior, polygons: components, bounds: [0, 0, 30, 10],
  }));
  recipe.initialize({ predictFn: predict, getImagePath: () => 'frame.png' });
  recipe.activate();
  const track = new Track(1, { begin: 0, end: 0 });
  return { recipe, predict, track };
}

it('carries every mask component through prediction and confirmation', async () => {
  const { recipe, track } = harness();
  const ready = await predicted(recipe, track, 5);
  expect(ready.polygons).toEqual(components);
  expect(ready.polygon).toEqual(components[0].exterior);

  const confirmed = new Promise<MultiFrameSegmentationResult>((resolve) => recipe.bus.$once('prediction-confirmed-multi', resolve));
  recipe.confirmPrediction();
  expect((await confirmed).frames.get(0)?.polygons).toEqual(components);
});

it('commits every component under its own key when polygon editing takes over', async () => {
  const { recipe, track } = harness();
  await predicted(recipe, track, 5);
  const response = recipe.update('editing', 0, track, [{
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: {},
  }]);
  expect(response.done).toBe(true);
  expect(Object.keys(response.data)).toEqual(['SegmentationPolygon', 'SegmentationPolygon-1']);
  expect(response.data['SegmentationPolygon-1'][0].geometry).toEqual({
    type: 'Polygon', coordinates: [[...components[1].exterior, components[1].exterior[0]]],
  });
});

it('re-emits the saved components when returning to a frame', async () => {
  const { recipe, track } = harness();
  await predicted(recipe, track, 5);
  recipe.handleFrameChange(1);
  const restored = new Promise<SegmentationPredictionResult>((resolve) => recipe.bus.$once('prediction-ready', resolve));
  recipe.handleFrameChange(0);
  expect((await restored).polygons).toEqual(components);
});
