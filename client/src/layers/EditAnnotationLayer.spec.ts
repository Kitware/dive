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
  const handles = { _clearSelectedFeatures: vi.fn() };
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
    features: () => [handles],
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
  const mouseButtons = { left: false };
  const interactor = { mouse: () => ({ buttons: mouseButtons }), retriggerMouseMove: vi.fn() };
  const project = (p: { x: number; y: number }) => ({ x: p.x * 10, y: p.y * 10 });
  const map = {
    createLayer: (type: string) => (type === 'annotation' ? featureLayer : { createFeature: () => arrow }),
    gcsToDisplay: (p: any) => (Array.isArray(p) ? p.map(project) : project(p)),
    displayToGcs: (p: any) => ({ x: p.x / 10, y: p.y / 10 }),
    interactor: () => interactor,
  };
  const annotator = { geoViewerRef: ref(map), setCursor: vi.fn(), setImageCursor: vi.fn() };
  const layer = new EditAnnotationLayer({
    type: 'LineString',
    annotator,
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
    layer, track, reopen, update, click, featureLayer, annotator, mouseButtons, handles, interactor,
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

it('does not carry a middle click on another Point layer into the next left click', () => {
  const consumed = harness();
  const idle = harness();
  [consumed, idle].forEach((h) => { h.layer.setType('Point'); h.layer.setMode('Point'); });
  const emitted = vi.fn();
  idle.layer.bus.$on('update:geojson', emitted);
  const finish = (h: ReturnType<typeof harness>, x: number) => h.layer.handleEditStateChange({
    annotation: {
      layer: () => h.featureLayer,
      state: () => 'done',
      geojson: () => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [x, 5] } }),
      style: vi.fn(),
      editHandleStyle: vi.fn(),
      highlightStyle: vi.fn(),
    },
  } as any);

  document.dispatchEvent(new MouseEvent('mousedown', { button: 1 }));
  consumed.layer.setShapeInProgress({ mouse: { buttons: { middle: true }, modifiers: {}, geo: { x: 1, y: 5 } } } as any);
  expect(consumed.layer.lastClickWasBackground).toBe(false);
  expect(idle.layer.lastClickWasBackground).toBe(true);

  document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  idle.layer.setShapeInProgress({ mouse: { buttons: {}, modifiers: {}, geo: { x: 2, y: 5 } } } as any);
  finish(idle, 2);
  expect(emitted).toHaveBeenCalledTimes(1);
  expect(emitted.mock.calls[0][2].properties.background).toBeUndefined();

  document.dispatchEvent(new MouseEvent('mousedown', { button: 0, shiftKey: true }));
  idle.layer.setShapeInProgress({ mouse: { buttons: {}, modifiers: { shift: true }, geo: { x: 3, y: 5 } } } as any);
  finish(idle, 3);
  expect(emitted.mock.calls[1][2].properties.background).toBe(true);
  [consumed, idle].forEach((h) => h.layer.destroy());
});

it('moves and commits only the annotation whose handle was grabbed when a peer layer is live', async () => {
  const h = harness(); await h.reopen();
  const annotation = h.featureLayer.annotations()[0];
  const process = vi.fn(() => true);
  annotation.diveDragGuard = false; annotation.processEditAction = process;
  h.layer.guardPeerDrags(annotation);
  const drag = { annotation: { ...annotation, layer: () => h.featureLayer }, action: 'actionup' };

  annotation.processEditAction({}); h.layer.handleEditAction(drag as any);
  expect(process).toHaveBeenCalledTimes(1);
  expect(h.update).toHaveBeenCalledTimes(1);

  h.layer.peer = h.layer; h.layer.ownsDrag = false;
  annotation.processEditAction({}); h.layer.handleEditAction(drag as any);
  expect(process).toHaveBeenCalledTimes(1);
  expect(h.update).toHaveBeenCalledTimes(1);

  h.layer.ownsDrag = true;
  annotation.processEditAction({}); h.layer.handleEditAction(drag as any);
  expect(process).toHaveBeenCalledTimes(2);
  expect(h.update).toHaveBeenCalledTimes(2);
});

it('limits a companion box editor to its corner handles', () => {
  const { layer } = harness();
  layer.companion = true;
  expect(layer.editHandleStyle().handles).toEqual({
    vertex: true, edge: false, center: false, rotate: false, resize: false,
  });
});

it('skips mode(null) when already disabled so a peer creation session stays intact', async () => {
  const h = harness();
  await h.layer.changeData([]);
  expect(h.layer.getMode()).toBe('creation');
  h.layer.disable();
  expect(h.layer.getMode()).toBe('disabled');
  const modeSpy = vi.spyOn(h.featureLayer, 'mode');
  h.layer.disable();
  // getMode() still reads mode() with no args; only mode(null) must be skipped.
  expect(modeSpy).not.toHaveBeenCalledWith(null);
});

it('reinstalls creation mode after a peer disable strips interactor actions', async () => {
  const h = harness();
  await h.layer.changeData([]);
  expect(h.layer.getMode()).toBe('creation');
  const modeSpy = vi.spyOn(h.featureLayer, 'mode');
  h.layer.restoreHandleActions();
  expect(modeSpy).toHaveBeenCalledWith('line');
  expect(h.layer.getMode()).toBe('creation');
});

it('does not restore the editing cursor after disable cancels a deferred changeData', async () => {
  vi.useFakeTimers();
  const h = harness();
  await h.reopen();
  expect(h.layer.getMode()).toBe('editing');
  expect(h.annotator.setImageCursor).toHaveBeenCalledWith('mdi-vector-line', true);

  // Cross-camera blank click: mousedown keeps the left button down so
  // changeData defers its reset, then LayerManager disable()s on deselect.
  h.mouseButtons.left = true;
  const editFrame = [{ features: h.track.features[0], track: h.track }] as any;
  await h.layer.changeData(editFrame);
  h.annotator.setImageCursor.mockClear();
  h.layer.disable();
  expect(h.layer.getMode()).toBe('disabled');
  expect(h.annotator.setImageCursor).toHaveBeenCalledWith('');

  h.mouseButtons.left = false;
  h.annotator.setImageCursor.mockClear();
  await vi.advanceTimersByTimeAsync(50);
  expect(h.layer.getMode()).toBe('disabled');
  expect(h.annotator.setImageCursor).not.toHaveBeenCalledWith('mdi-vector-line', true);
  vi.useRealTimers();
});

it('re-hovers the handle under a stationary cursor after the edit annotation is rebuilt', async () => {
  vi.useFakeTimers();
  const h = harness(); await h.reopen();
  vi.runAllTimers();
  expect(h.handles._clearSelectedFeatures).toHaveBeenCalledTimes(1);
  expect(h.interactor.retriggerMouseMove).toHaveBeenCalledTimes(1);
  h.layer.disable(); await h.layer.changeData([]);
  vi.runAllTimers();
  expect(h.interactor.retriggerMouseMove).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
