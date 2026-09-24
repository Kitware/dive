import Vue, { ref } from 'vue';
import useAnnotationClickHandling from './useAnnotationClickHandling';

function harness(type = 'LineString', selectedCamera = 'left') {
  const layer = () => ({ bus: new Vue() });
  const polygon = layer();
  const selectedKey = ref(type === 'LineString' ? 'HeadTails' : '');
  const selectFeatureHandle = vi.fn((_index, key) => { selectedKey.value = key; });
  const cancelCreation = vi.fn();
  const edit = { ...layer(), type, getMode: () => 'editing' };
  const refresh = vi.fn();
  useAnnotationClickHandling({
    camera: 'left',
    selectedCamera: ref(selectedCamera),
    selectedTrackIdRef: ref(1),
    selectedKeyRef: selectedKey,
    frameNumberRef: ref(0),
    flickNumberRef: ref(0),
    editingModeRef: ref(type),
    editAnnotationLayer: edit,
    polyAnnotationLayer: polygon,
    rectAnnotationLayer: layer(),
    lineLayer: layer(),
    handler: { selectFeatureHandle, cancelCreation, registerFinalizeCreation: vi.fn() },
    refreshLayers: refresh,
  } as never).wireHandlers();
  return {
    polygon, selectedKey, selectFeatureHandle, cancelCreation, edit, refresh,
  };
}

it.each(['polygon-clicked', 'polygon-right-clicked', 'polygon-right-clicked-outside'])('keeps the saved line selected when a visible mask emits %s', (event) => {
  const h = harness();
  h.polygon.bus.$emit(event, 1, 'segmentation');
  expect(h.selectedKey.value).toBe('HeadTails');
  expect(h.selectFeatureHandle).not.toHaveBeenCalled();
  expect(h.cancelCreation).not.toHaveBeenCalled();
});

it('defers polygon key selection to the edit layer while polygon editing', () => {
  const h = harness('Polygon');
  h.polygon.bus.$emit('polygon-right-clicked', 1, 'segmentation');
  expect(h.selectedKey.value).toBe('');
  expect(h.selectFeatureHandle).not.toHaveBeenCalled();
});

it('defers to the edit layer on a camera that is not selected while polygon editing', () => {
  const h = harness('Polygon', 'right');
  h.polygon.bus.$emit('polygon-right-clicked', 1, 'segmentation');
  h.polygon.bus.$emit('polygon-right-clicked-outside');
  expect(h.selectFeatureHandle).not.toHaveBeenCalled();
  expect(h.cancelCreation).not.toHaveBeenCalled();
});

it('does not cancel in-progress line creation when a mask is right-clicked', () => {
  const h = harness(); h.edit.getMode = () => 'creation';
  h.polygon.bus.$emit('polygon-right-clicked', 1, 'segmentation');
  h.polygon.bus.$emit('polygon-right-clicked-outside');
  expect(h.cancelCreation).not.toHaveBeenCalled();
  expect(h.selectedKey.value).toBe('HeadTails');
});

describe('right-clicking the edited detection on another camera', () => {
  function editHarness(type = 'rectangle') {
    const layer = () => ({ bus: new Vue() });
    const camera = ref('right');
    const selected = ref<number | null>(1);
    const mode = ref<false | string>(type);
    const edit = { ...layer(), type, getMode: () => 'editing' };
    const rectangle = layer();
    const line = layer();
    const handler = {
      selectCamera: vi.fn((next: string) => { camera.value = next; }),
      trackSelect: vi.fn((id: number | null, editing: boolean) => {
        selected.value = id;
        mode.value = editing ? type : false;
      }),
      trackEdit: vi.fn(),
      selectFeatureHandle: vi.fn(),
      cancelCreation: vi.fn(),
      registerFinalizeCreation: vi.fn(),
    };
    const refresh = vi.fn();
    useAnnotationClickHandling({
      camera: 'left',
      selectedCamera: camera,
      selectedTrackIdRef: selected,
      selectedKeyRef: ref(''),
      frameNumberRef: ref(0),
      flickNumberRef: ref(0),
      editingModeRef: mode,
      editAnnotationLayer: edit,
      polyAnnotationLayer: layer(),
      rectAnnotationLayer: rectangle,
      lineLayer: line,
      handler,
      refreshLayers: refresh,
    } as never).wireHandlers();
    // GeoJS ends this camera's editor on the same click.
    const editorEnds = () => edit.bus.$emit('editing-annotation-sync', false);
    return {
      camera, selected, mode, edit, rectangle, line, handler, refresh, editorEnds,
    };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it.each(['before', 'after'])('moves the edit to the clicked camera when its editor ends %s the click', (order) => {
    const h = editHarness();
    if (order === 'before') h.editorEnds();
    h.rectangle.bus.$emit('edited-annotation-right-clicked', 1);
    h.line.bus.$emit('edited-annotation-right-clicked', 1);
    if (order === 'after') h.editorEnds();
    vi.runAllTimers();
    expect(h.handler.selectCamera).toHaveBeenCalledExactlyOnceWith('left', false);
    expect(h.camera.value).toBe('left');
    expect(h.selected.value).toBe(1);
    expect(h.mode.value).toBe('rectangle');
    if (order === 'after') expect(h.handler.trackSelect).not.toHaveBeenCalled();
    else expect(h.handler.trackSelect).toHaveBeenLastCalledWith(1, true);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('still finishes the edit on the selected camera', () => {
    const h = editHarness(); h.camera.value = 'left';
    h.rectangle.bus.$emit('edited-annotation-right-clicked', 1);
    h.editorEnds();
    vi.runAllTimers();
    expect(h.handler.selectCamera).not.toHaveBeenCalled();
    expect(h.mode.value).toBe(false);
    expect(h.selected.value).toBe(1);
  });

  it('ignores another detection and a camera it cannot select', () => {
    const h = editHarness();
    h.rectangle.bus.$emit('edited-annotation-right-clicked', 2);
    expect(h.handler.selectCamera).not.toHaveBeenCalled();
    h.handler.selectCamera.mockImplementation(() => undefined);
    h.rectangle.bus.$emit('edited-annotation-right-clicked', 1);
    h.editorEnds();
    vi.runAllTimers();
    expect(h.mode.value).toBe(false);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('leaves polygon editing to the polygon editor', () => {
    const h = editHarness('Polygon');
    h.rectangle.bus.$emit('edited-annotation-right-clicked', 1);
    expect(h.handler.selectCamera).not.toHaveBeenCalled();
  });
});

describe('a point-mode right-click that lands on another camera', () => {
  function pointHarness() {
    const layer = () => ({ bus: new Vue() });
    const camera = ref('left');
    const edit = { ...layer(), type: 'Point', getMode: () => 'creation' };
    const handler = {
      confirmRecipe: vi.fn(),
      segmentationFinalizePending: vi.fn(),
      registerFinalizeCreation: vi.fn(),
    };
    useAnnotationClickHandling({
      camera: 'left',
      selectedCamera: camera,
      selectedTrackIdRef: ref(1),
      selectedKeyRef: ref(''),
      frameNumberRef: ref(0),
      flickNumberRef: ref(0),
      editingModeRef: ref('Point'),
      editAnnotationLayer: edit,
      polyAnnotationLayer: layer(),
      rectAnnotationLayer: layer(),
      lineLayer: layer(),
      handler,
      refreshLayers: vi.fn(),
    } as never).wireHandlers();
    return { camera, edit, handler };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('locks the mask without deselecting when the other camera takes the edit', () => {
    const h = pointHarness();
    h.edit.bus.$emit('confirm-annotation-elsewhere', true);
    expect(h.handler.segmentationFinalizePending).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(h.handler.confirmRecipe).not.toHaveBeenCalled();
    h.camera.value = 'right';
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.runAllTimers();
    expect(h.handler.confirmRecipe).not.toHaveBeenCalled();
  });

  it.each([true, false])('finishes the edit as before when nothing takes it over (button held: %s)', (held) => {
    const h = pointHarness();
    h.edit.bus.$emit('confirm-annotation-elsewhere', held);
    if (held) document.dispatchEvent(new MouseEvent('mouseup'));
    vi.runAllTimers();
    expect(h.handler.confirmRecipe).toHaveBeenCalledOnce();
  });
});
