import {
  headTailFeatures, orderedHeadTail, syncHeadTail, sampleHeadTail,
} from './headTail';
import Track from './track';
import HeadTail from '../dive-common/recipes/headtail';

describe('editable centerlines', () => {
  it('orders numeric names regardless of CSV column order', () => {
    const points = ['tail', 'spine_010', 'head', 'spine_002'].map((key, i): GeoJSON.Feature<GeoJSON.Point> => ({
      type: 'Feature', properties: { key }, geometry: { type: 'Point', coordinates: [i, 0] },
    }));
    expect(orderedHeadTail(points)).toEqual([[2, 0], [3, 0], [1, 0], [0, 0]]);
  });
  it('retains fractional vertices and unrelated geometry', () => {
    const curve = [[1.25, 2.5], [3.125, 8.5], [9, 4]];
    const other: GeoJSON.Feature<GeoJSON.Point> = { type: 'Feature', properties: { key: 'eye' }, geometry: { type: 'Point', coordinates: [2, 3] } };
    const features = syncHeadTail([...headTailFeatures(curve), other]);
    expect(orderedHeadTail(features)).toEqual(curve);
    expect(features).toContain(other);
  });
  it('inserts, moves, and deletes interior vertices using the existing recipe', () => {
    const track = new Track(0, { meta: {}, begin: 0, end: 0 });
    track.setFeature({ frame: 0, keyframe: true, bounds: [0, 0, 100, 100] }, headTailFeatures([[10, 10], [90, 10]]));
    track.setFeature({ frame: 0, fishLength: 42, attributes: { length: 42 } });
    const recipe = new HeadTail();
    const curve: GeoJSON.Feature<GeoJSON.LineString> = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[10, 10], [40.5, 30.5], [60, 40], [90, 10]] } };
    const update = recipe.update('editing', 0, track, [curve], 'HeadTails');
    track.setFeature({ frame: 0 }, Object.values(update.data).flat());
    expect(track.features[0].fishLength).toBeUndefined();
    expect(track.features[0].attributes?.measurement_stale).toBe(true);
    recipe.deletePoint(0, track, 1, 'HeadTails', 'LineString');
    expect(orderedHeadTail(track.features[0].geometry!.features)).toEqual([[10, 10], [60, 40], [90, 10]]);
    expect(track.getFeatureGeometry(0, { key: 'spine_002' })).toHaveLength(0);
    recipe.deletePoint(0, track, 1, 'HeadTails', 'LineString');
    expect(orderedHeadTail(track.features[0].geometry!.features)).toEqual([[10, 10], [90, 10]]);
    expect(track.getFeatureGeometry(0, { key: 'spine_001' })).toHaveLength(0);
    recipe.deletePoint(0, track, 0, 'HeadTails', 'LineString');
    expect(track.getFeatureGeometry(0, { key: 'tail' })).toHaveLength(1);
    expect(track.getFeatureGeometry(0, { key: 'HeadTails' })).toHaveLength(0);
  });
  it('samples a curve without dropping its endpoints', () => {
    const sampled = sampleHeadTail([[0, 0], [0, 10], [10, 10]], 5);
    expect(sampled).toEqual([[0, 0], [0, 5], [0, 10], [5, 10], [10, 10]]);
  });
});
