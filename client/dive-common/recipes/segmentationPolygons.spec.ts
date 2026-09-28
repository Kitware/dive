import {
  closedRing, componentsBounds, isSegmentationPolygonKey, segmentationComponents, segmentationPolygonFeatures,
} from './segmentationPolygons';

const components = [
  { exterior: [[0, 0], [10, 0], [10, 10]] as [number, number][], holes: [[[2, 2], [4, 2], [4, 4]] as [number, number][]] },
  { exterior: [[20, 0], [30, 0], [30, 10]] as [number, number][], holes: [] },
];

it('prefers the full mask over the legacy polygon and drops degenerate components', () => {
  expect(segmentationComponents({ polygon: components[0].exterior, polygons: components })).toEqual(components);
  expect(segmentationComponents({ polygon: components[0].exterior })).toEqual([{ exterior: components[0].exterior, holes: [] }]);
  expect(segmentationComponents({ polygon: [[0, 0], [1, 1]], polygons: [{ exterior: [[0, 0]], holes: [] }] })).toEqual([]);
  expect(segmentationComponents({})).toEqual([]);
});

it('keys each component off the base key and closes every ring', () => {
  const features = segmentationPolygonFeatures(components, 'Seg');
  expect(features.map((f) => f.properties?.key)).toEqual(['Seg', 'Seg-1']);
  expect(features[0].geometry.coordinates).toEqual([
    [...components[0].exterior, components[0].exterior[0]],
    [...components[0].holes[0], components[0].holes[0][0]],
  ]);
  expect(closedRing([[0, 0], [4, 0], [0, 0]])).toHaveLength(3);
  expect(isSegmentationPolygonKey('Seg-3', 'Seg')).toBe(true);
  expect(isSegmentationPolygonKey('Segment', 'Seg')).toBe(false);
  expect(componentsBounds(components)).toEqual([0, 0, 30, 10]);
});
