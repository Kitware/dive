import { ref } from 'vue';
import PointLayer from './PointLayer';

function styling() {
  const layer = Object.create(PointLayer.prototype) as PointLayer;
  Object.assign(layer, {
    stateStyling: { standard: { strokeWidth: 3, opacity: 0.4 }, selected: { strokeWidth: 4, color: 'yellow' } },
    typeStyling: ref({ color: () => 'blue', strokeWidth: () => 3, opacity: () => 0.4 }),
  });
  return layer.createStyle() as Record<string, (data: Record<string, unknown>) => unknown>;
}

it.each([false, 'Polygon'])('renders non-line-editing interior points as smaller solid circles (%s)', (editing) => {
  const style = styling();
  const data = {
    feature: 'spine_001', editing, selected: false, styleType: ['fish', 1],
  };
  expect(style.radius(data)).toBe(4.5);
  expect(style.fill(data)).toBe(true);
  expect(style.fillOpacity(data)).toBe(1);
  expect(style.fillColor(data)).toBe(style.strokeColor(data));
  expect(style.fillColor({ ...data, selected: true })).toBe('yellow');
});

it('preserves endpoint appearance and line-editing marker appearance', () => {
  const style = styling();
  const data = { editing: false, selected: false, styleType: ['fish', 1] };
  expect(style.radius({ ...data, feature: 'head' })).toBe(6);
  expect(style.fill({ ...data, feature: 'head' })).toBe(true);
  expect(style.fillOpacity({ ...data, feature: 'head' })).toBe(0.4);
  expect(style.radius({ ...data, feature: 'tail' })).toBe(6);
  expect(style.fill({ ...data, feature: 'tail' })).toBe(false);
  expect(style.radius({ ...data, feature: 'spine_001', editing: 'LineString' })).toBe(6);
  expect(style.fill({ ...data, feature: 'spine_001', editing: 'LineString' })).toBe(false);
});
