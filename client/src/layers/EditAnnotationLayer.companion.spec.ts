// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- GeoJS boundary */
import geo from 'geojs';
import { ref } from 'vue';
import EditAnnotationLayer from './EditAnnotationLayer';
import Track from '../track';
import { headTailFeatures } from '../headTail';

/** Real GeoJS: both layers sit in edit mode on one map, as in LayerManager. */
beforeAll(() => (geo.util as any).mockWebglRenderer());

const liveLayers: EditAnnotationLayer[] = [];

afterEach(() => {
  // Cancel deferred changeData timeouts before jsdom tears down `window`.
  liveLayers.splice(0).forEach((layer) => layer.disable());
});

async function harness() {
  const node = document.createElement('div');
  document.body.appendChild(node);
  const map = geo.map({
    node, width: 800, height: 600, ...geo.util.pixelCoordinateParams(node, 800, 600, 800, 600).map,
  });
  const cursors: string[] = [];
  const params = {
    annotator: { geoViewerRef: ref(map), setCursor: (c: string) => cursors.push(c), setImageCursor: vi.fn() },
    stateStyling: { standard: { color: '#f00' }, selected: { color: '#f00' } },
    typeStyling: ref({ color: () => '#f00', strokeWidth: () => 1, opacity: () => 1 }),
  } as any;
  const line = new EditAnnotationLayer({ ...params, type: 'LineString' });
  const box = new EditAnnotationLayer({ ...params, type: 'rectangle', companion: true });
  liveLayers.push(line, box);
  line.peer = box; box.peer = line;
  line.setKey('HeadTails');
  const track = new Track(1, { begin: 0, end: 0, meta: {} });
  track.setFeature({ frame: 0, keyframe: true, bounds: [50, 50, 400, 400] }, headTailFeatures([[100, 100], [300, 300]]));
  const frameData = [{ features: track.features[0], track }] as any;
  await line.changeData(frameData); await box.changeData(frameData);
  const lineUpdate = vi.fn(); const boxUpdate = vi.fn();
  line.bus.$on('update:geojson', lineUpdate); box.bus.$on('update:geojson', boxUpdate);
  const mouse = (type: string, x: number, y: number) => map.interactor().simulateEvent(type, { map: { x, y }, button: 'left' });
  const drag = (x: number, y: number, dx: number, dy: number) => {
    mouse('mousemove', x, y); mouse('mousedown', x, y);
    mouse('mousemove', x + dx, y + dy); mouse('mouseup', x + dx, y + dy);
  };
  const round = (coords: number[][]) => coords.map(([x, y]) => [Math.round(x), Math.round(y)]);
  const lineCoords = () => round(line.featureLayer.annotations()[0].geojson().geometry.coordinates);
  const boxCoords = () => round(box.featureLayer.annotations()[0].geojson().geometry.coordinates[0]);
  return {
    mouse, drag, lineUpdate, boxUpdate, lineCoords, boxCoords, line, box, frameData, cursors,
  };
}

it('drags a box corner in line mode without disturbing a previously hovered line vertex', async () => {
  const h = await harness();
  h.mouse('mousemove', 100, 100); h.mouse('mousemove', 75, 75);
  h.drag(50, 50, -20, -20);
  expect(h.boxUpdate).toHaveBeenCalledTimes(1);
  expect(h.boxUpdate.mock.calls[0][3]).toBe('rectangle');
  expect(h.boxCoords()).toContainEqual([30, 30]);
  expect(h.lineUpdate).not.toHaveBeenCalled();
  expect(h.lineCoords()).toEqual([[100, 100], [300, 300]]);
});

it('drags a line vertex without disturbing a previously hovered box corner', async () => {
  const h = await harness();
  h.mouse('mousemove', 50, 50); h.mouse('mousemove', 75, 75);
  h.drag(100, 100, 30, 10);
  expect(h.lineUpdate).toHaveBeenCalledTimes(1);
  expect(h.lineCoords()).toEqual([[130, 110], [300, 300]]);
  expect(h.boxUpdate).not.toHaveBeenCalled();
  expect(h.boxCoords()).toContainEqual([50, 50]);
});

it('keeps a hovered box corner draggable after the line layer leaves and re-enters edit mode', async () => {
  const h = await harness();
  h.mouse('mousemove', 50, 50);
  h.line.disable();
  await h.line.changeData(h.frameData);
  h.mouse('mousedown', 50, 50); h.mouse('mousemove', 30, 30); h.mouse('mouseup', 30, 30);
  expect(h.boxUpdate).not.toHaveBeenCalled();

  h.box.restoreHandleActions();
  h.mouse('mousedown', 50, 50); h.mouse('mousemove', 30, 30); h.mouse('mouseup', 30, 30);
  expect(h.boxUpdate).toHaveBeenCalledTimes(1);
  expect(h.boxCoords()).toContainEqual([30, 30]);
});

it('shows the hand over a line vertex and a resize cursor only over a box corner', async () => {
  const h = await harness();
  h.cursors.length = 0;
  h.mouse('mousemove', 100, 100);
  expect(h.cursors).toEqual(['grab']);
  h.cursors.length = 0;
  h.mouse('mousemove', 200, 30); h.mouse('mousemove', 50, 50);
  expect(h.cursors.at(-1)).toBe('nw-resize');
  expect(h.cursors).not.toContain('grab');
});

it('moves a lone head point while the line tool waits for its tail', async () => {
  const node = document.createElement('div');
  document.body.appendChild(node);
  const map = geo.map({
    node, width: 800, height: 600, ...geo.util.pixelCoordinateParams(node, 800, 600, 800, 600).map,
  });
  const params = {
    annotator: { geoViewerRef: ref(map), setCursor: vi.fn(), setImageCursor: vi.fn() },
    stateStyling: { standard: { color: '#f00' }, selected: { color: '#f00' } },
    typeStyling: ref({ color: () => '#f00', strokeWidth: () => 1, opacity: () => 1 }),
  } as any;
  const line = new EditAnnotationLayer({ ...params, type: 'LineString' });
  const point = new EditAnnotationLayer({ ...params, type: 'rectangle', companion: true });
  liveLayers.push(line, point);
  line.peer = point; point.peer = line;
  line.setKey('HeadTails'); point.setType('Point'); point.setKey('head');
  const track = new Track(1, { begin: 0, end: 0, meta: {} });
  track.setFeature({ frame: 0, keyframe: true, bounds: [50, 50, 400, 400] }, [{
    type: 'Feature', properties: { key: 'head' }, geometry: { type: 'Point', coordinates: [100, 100] },
  }]);
  const frameData = [{ features: track.features[0], track }] as any;
  await line.changeData(frameData); await point.changeData(frameData);
  expect(line.getMode()).toBe('creation');
  expect(point.getMode()).toBe('editing');
  const lineUpdate = vi.fn(); const pointUpdate = vi.fn();
  line.bus.$on('update:geojson', lineUpdate); point.bus.$on('update:geojson', pointUpdate);
  const mouse = (type: string, x: number, y: number) => map.interactor().simulateEvent(type, { map: { x, y }, button: 'left' });
  mouse('mousemove', 100, 100); mouse('mousedown', 100, 100);
  mouse('mousemove', 130, 110); mouse('mouseup', 130, 110);
  expect(pointUpdate).toHaveBeenCalledTimes(1);
  expect(pointUpdate.mock.calls[0][2].geometry).toEqual({ type: 'Point', coordinates: [130, 110] });
  expect(pointUpdate.mock.calls[0][4]).toBe('head');
  expect(lineUpdate).not.toHaveBeenCalled();
  expect(line.shapeInProgress).toBeNull();
  // Leaving the handle gives the line tool its click-to-place actions back.
  mouse('mousemove', 300, 300);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(map.interactor().hasAction(undefined, undefined, geo.annotation.actionOwner)).toBeTruthy();
});
