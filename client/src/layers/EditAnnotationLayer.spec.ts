// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- GeoJS boundary double */
import { ref } from 'vue';
import EditAnnotationLayer from './EditAnnotationLayer';
import Track from '../track';
import { headTailFeatures } from '../headTail';

vi.mock('geojs', () => ({
  default: {
    event: {
      mouseclick: 'mouseclick',
      actiondown: 'actiondown',
      actionup: 'actionup',
      annotation: { edit_action: 'edit_action', state: 'state', select_edit_handle: 'select_edit_handle' },
    },
  },
}));

function harness() {
  const handlers = new Map<string, Set<(event: any) => void>>();
  let mode: string | null = null;
  let annotation: any;
  const featureLayer: any = {
    annotations: () => (annotation ? [annotation] : []),
    mode: (value?: string | null, edited?: any) => {
      if (value === undefined) return mode;
      mode = value;
      if (edited) annotation = edited;
      return mode;
    },
    _handleMouseClick: vi.fn(() => { mode = null; }),
    geoOn: (name: string, fn: (e: any) => void) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)!.add(fn);
    },
    geoOff: (name: string, fn: (e: any) => void) => handlers.get(name)?.delete(fn),
    removeAllAnnotations: () => { annotation = undefined; },
    draw: vi.fn(),
    geojson: (feature: GeoJSON.Feature<GeoJSON.LineString>) => {
      let vertices = feature.geometry.coordinates.map(([x, y]) => ({ x, y }));
      annotation = {
        state: () => (mode === 'edit' ? 'edit' : 'done'),
        options: (_key: string, value?: typeof vertices) => {
          if (value) vertices = value;
          return vertices;
        },
        geojson: () => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: vertices.map(({ x, y }) => [x, y]) } }),
        style: vi.fn(),
        editHandleStyle: vi.fn(),
        highlightStyle: vi.fn(),
      };
    },
  };
  featureLayer.geoOn('mouseclick', featureLayer._handleMouseClick);
  const arrow: any = { style: vi.fn(), draw: vi.fn(), data: () => arrow };
  const interactor = { mouse: () => ({ buttons: { left: false } }) };
  const project = (p: { x: number; y: number }) => ({ x: p.x * 10, y: p.y * 10 });
  const map = {
    createLayer: (type: string) => (type === 'annotation' ? featureLayer : { createFeature: () => arrow }),
    gcsToDisplay: (p: any) => (Array.isArray(p) ? p.map(project) : project(p)),
    displayToGcs: (p: any) => ({ x: p.x / 10, y: p.y / 10 }),
    interactor: () => interactor,
  };
  const layer = new EditAnnotationLayer({
    type: 'LineString',
    annotator: { geoViewerRef: ref(map), setCursor: vi.fn(), setImageCursor: vi.fn() },
    stateStyling: { standard: { color: '#f00' }, selected: { color: '#f00' } },
    typeStyling: ref({ color: () => '#f00' }),
  } as any);
  layer.setKey('HeadTails');
  const track = new Track(1, { begin: 0, end: 0, meta: {} });
  track.setFeature({ frame: 0, keyframe: true, bounds: [0, 0, 100, 30] }, headTailFeatures([[0, 10], [100, 10]]));
  const reopen = () => layer.changeData([{ features: track.features[0], track }] as any);
  const update = vi.fn((_mode, _done, feature, _type, key, cb) => {
    expect(key).toBe('HeadTails');
    track.setFeature({ frame: 0 }, headTailFeatures(feature.geometry.coordinates));
    cb?.();
    reopen();
  });
  layer.bus.$on('update:geojson', update);
  const click = (x: number, y: number, right = false) => {
    const event = { buttonsDown: { left: !right, right }, geo: { x, y }, handled: false };
    handlers.get('mouseclick')!.forEach((fn) => fn(event));
  };
  return {
    layer, track, reopen, update, click, featureLayer,
  };
}

it('makes the insertion handle accessible on a two-point line', () => {
  const { layer } = harness();
  expect(layer.editHandleStyle().handles).toMatchObject({ edge: true, center: false });
  layer.setType('Polygon');
  expect(layer.editHandleStyle().handles).toMatchObject({ edge: true, center: true });
});

it('inserts a clicked segment point, selects it for deletion, and stays in edit mode', async () => {
  const h = harness(); await h.reopen();
  h.click(25, 10.25);
  expect(h.track.getFeatureGeometry(0, { key: 'HeadTails' })[0].geometry.coordinates).toEqual([[0, 10], [25, 10.25], [100, 10]]);
  expect(h.layer.selectedHandleIndex).toBe(2);
  expect(h.layer.getMode()).toBe('editing');
  expect(h.featureLayer._handleMouseClick).not.toHaveBeenCalled();
  expect(h.update).toHaveBeenCalledTimes(1);
});

it('leaves vertex clicks and clicks beyond screen-space tolerance to GeoJS', async () => {
  const h = harness(); await h.reopen();
  h.click(0.1, 10);
  expect(h.update).not.toHaveBeenCalled();
  await h.reopen(); h.click(25, 12);
  expect(h.update).not.toHaveBeenCalled();
  expect(h.featureLayer._handleMouseClick).toHaveBeenCalledTimes(2);
});

it('synchronizes right-click exits and reopens the saved line repeatedly', async () => {
  const h = harness();
  const sync = vi.fn(); h.layer.bus.$on('editing-annotation-sync', sync);
  for (let i = 0; i < 3; i += 1) {
    // Each edit session must finish before the next right-click/reopen.
    // eslint-disable-next-line no-await-in-loop
    await h.reopen();
    expect(h.layer.getMode()).toBe('editing');
    h.click(20 + i * 10, 10);
    expect(h.layer.getMode()).toBe('editing');
    h.click(50, 20, true);
    expect(h.layer.getMode()).toBe('disabled');
    expect(sync).toHaveBeenLastCalledWith(false);
    h.layer.disable();
  }
  expect(h.track.getFeatureGeometry(0, { key: 'HeadTails' })[0].geometry.coordinates).toHaveLength(5);
});
