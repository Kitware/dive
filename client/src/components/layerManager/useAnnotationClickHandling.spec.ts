import Vue, { ref } from 'vue';
import useAnnotationClickHandling from './useAnnotationClickHandling';

function harness(type = 'LineString') {
  const layer = () => ({ bus: new Vue() });
  const polygon = layer();
  const selectedKey = ref(type === 'LineString' ? 'HeadTails' : '');
  const selectFeatureHandle = vi.fn((_index, key) => { selectedKey.value = key; });
  const cancelCreation = vi.fn();
  const edit = { ...layer(), type, getMode: () => 'editing' };
  const refresh = vi.fn();
  useAnnotationClickHandling({
    camera: 'left',
    selectedCamera: ref('left'),
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

it('still selects a mask key when selecting another detection in polygon mode', () => {
  const h = harness('Polygon');
  h.polygon.bus.$emit('polygon-right-clicked', 2, 'segmentation');
  expect(h.selectedKey.value).toBe('segmentation');
  expect(h.selectFeatureHandle).toHaveBeenCalledWith(-1, 'segmentation');
});

it('does not cancel in-progress line creation when a mask is right-clicked', () => {
  const h = harness(); h.edit.getMode = () => 'creation';
  h.polygon.bus.$emit('polygon-right-clicked', 1, 'segmentation');
  h.polygon.bus.$emit('polygon-right-clicked-outside');
  expect(h.cancelCreation).not.toHaveBeenCalled();
  expect(h.selectedKey.value).toBe('HeadTails');
});
