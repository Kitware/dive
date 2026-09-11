import Vue, { ref } from 'vue';
import useAnnotationClickHandling from './useAnnotationClickHandling';
import type { EditAnnotationTypes } from '../../layers/EditAnnotationLayer';

const ring = (x0: number, y0: number, x1: number, y1: number) => [
  [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0],
];

function harness() {
  const selected = ref<number | null>(1);
  const key = ref('first');
  const mode = ref<false | EditAnnotationTypes>('Polygon');
  const frame = ref(0);
  const camera = ref('left');
  const layer = () => ({ bus: new Vue() });
  const edit = {
    ...layer(), type: 'Polygon', getMode: () => 'editing', disable: vi.fn(),
  };
  const polygons = {
    ...layer(),
    formattedData: [
      {
        trackId: 1, polygonKey: 'first', polygon: { type: 'Polygon', coordinates: [ring(0, 0, 10, 10)] }, isHole: false,
      },
      {
        trackId: 1, polygonKey: 'second', polygon: { type: 'Polygon', coordinates: [ring(20, 0, 30, 10), ring(23, 3, 27, 7)] }, isHole: false,
      },
      {
        trackId: 1, polygonKey: 'second', polygon: { type: 'Polygon', coordinates: [ring(23, 3, 27, 7)] }, isHole: true,
      },
    ],
  };
  const handler = {
    trackSelect: vi.fn((id: number | null, editing: boolean) => {
      selected.value = id;
      mode.value = editing ? 'Polygon' : false;
    }),
    selectFeatureHandle: vi.fn((_index, selectedKey) => { key.value = selectedKey; }),
    registerFinalizeCreation: vi.fn(),
    cancelCreation: vi.fn(),
  };
  const refresh = vi.fn();
  useAnnotationClickHandling({
    camera: 'left',
    selectedCamera: camera,
    selectedTrackIdRef: selected,
    selectedKeyRef: key,
    editingModeRef: mode,
    frameNumberRef: frame,
    flickNumberRef: ref(0),
    editAnnotationLayer: edit,
    polyAnnotationLayer: polygons,
    rectAnnotationLayer: layer(),
    lineLayer: layer(),
    handler,
    alignedView: { mapNativePoint: (x: number, y: number) => [x, y] },
    refreshLayers: refresh,
  } as never).wireHandlers();
  const click = (x: number, y: number) => edit.bus.$emit('polygon-edit-right-click', { x, y });
  return {
    selected, key, mode, frame, camera, edit, polygons, handler, refresh, click,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it.each(['before', 'after'])('switches polygons with one click when the polygon layer runs %s the editor', (order) => {
  const h = harness();
  const saved = JSON.stringify(h.polygons.formattedData);
  if (order === 'before') h.polygons.bus.$emit('polygon-right-clicked', 1, 'second');
  h.click(21, 5);
  if (order === 'after') h.polygons.bus.$emit('polygon-right-clicked', 1, 'second');
  // GeoJS finishes the old annotation during the same mouse event.
  h.mode.value = false;
  vi.runAllTimers();
  expect(h.mode.value).toBe('Polygon');
  expect(h.key.value).toBe('second');
  expect(h.selected.value).toBe(1);
  expect(h.handler.trackSelect).toHaveBeenCalledExactlyOnceWith(1, true);
  expect(h.refresh).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(h.polygons.formattedData)).toBe(saved);
});

it('finishes the current polygon when right-clicking it again', () => {
  const h = harness(); h.click(5, 5); vi.runAllTimers();
  expect(h.mode.value).toBe(false);
  expect(h.selected.value).toBe(1);
  expect(h.key.value).toBe('first');
});

it.each([[15, 5], [25, 5]])('finishes editing in a gap or hole at %j', (x, y) => {
  const h = harness(); h.click(x, y); vi.runAllTimers();
  expect(h.mode.value).toBe(false);
  expect(h.selected.value).toBe(1);
  expect(h.key.value).toBe('first');
});

it('preserves deselection when another layer handles a click outside the detection', () => {
  const h = harness(); h.click(50, 50);
  h.handler.trackSelect(null, false);
  vi.runAllTimers();
  expect(h.selected.value).toBe(null);
  expect(h.handler.trackSelect).toHaveBeenCalledTimes(1);
  expect(h.refresh).not.toHaveBeenCalled();
});

it.each(['frame', 'camera', 'track'])('does not apply a queued switch after the %s changes', (kind) => {
  const h = harness(); h.click(21, 5);
  if (kind === 'frame') h.frame.value = 1;
  if (kind === 'camera') h.camera.value = 'right';
  if (kind === 'track') h.selected.value = 2;
  vi.runAllTimers();
  expect(h.handler.trackSelect).not.toHaveBeenCalled();
});

it('allows switching to a polygon with the default empty key', () => {
  const h = harness(); h.polygons.formattedData[1].polygonKey = '';
  h.click(21, 5); vi.runAllTimers();
  expect(h.key.value).toBe('');
  expect(h.mode.value).toBe('Polygon');
});

it('ignores another camera and non-polygon editing modes', () => {
  const h = harness(); h.camera.value = 'right'; h.click(21, 5);
  h.camera.value = 'left'; h.mode.value = 'LineString'; h.click(21, 5);
  vi.runAllTimers();
  expect(h.handler.trackSelect).not.toHaveBeenCalled();
});
