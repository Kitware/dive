import lineCompanion from './lineCompanion';
import type { FrameDataTrack } from '../../layers/LayerTypes';

function trackFrame(options: { bounds?: boolean; line?: number; key?: string; points?: string[] } = {}): FrameDataTrack {
  const {
    bounds = true, line = 2, key = 'HeadTails', points = [],
  } = options;
  return {
    features: {
      frame: 0,
      bounds: bounds ? [0, 0, 10, 10] : undefined,
      geometry: {
        type: 'FeatureCollection',
        features: [
          ...(line ? [{
            type: 'Feature',
            properties: { key },
            geometry: { type: 'LineString', coordinates: Array.from({ length: line }, (_, i) => [i, i]) },
          }] : []),
          ...points.map((name) => ({
            type: 'Feature', properties: { key: name }, geometry: { type: 'Point', coordinates: [3, 4] },
          })),
        ],
      },
    },
  } as unknown as FrameDataTrack;
}

it('offers the box corners while an existing line is edited with boxes visible', () => {
  const tracks = [trackFrame({ points: ['head', 'tail'] })];
  expect(lineCompanion('LineString', true, 'HeadTails', tracks)).toEqual({ type: 'rectangle', key: '', tracks });
  expect(lineCompanion('LineString', false, 'HeadTails', tracks)).toBeNull();
  expect(lineCompanion('rectangle', true, 'HeadTails', tracks)).toBeNull();
  expect(lineCompanion(false, true, 'HeadTails', tracks)).toBeNull();
  expect(lineCompanion('LineString', true, 'HeadTails', [trackFrame({ bounds: false })])).toBeNull();
});

it('offers a lone head or tail point so it can be moved instead of only extended', () => {
  const head = [trackFrame({ line: 0, points: ['head'] })];
  expect(lineCompanion('LineString', false, 'HeadTails', head)).toEqual({ type: 'Point', key: 'head', tracks: head });
  const tail = [trackFrame({ line: 0, points: ['tail'], bounds: false })];
  expect(lineCompanion('LineString', true, 'HeadTails', tail)).toEqual({ type: 'Point', key: 'tail', tracks: tail });
});

it('stays out of the way while a line is being drawn or has both points', () => {
  expect(lineCompanion('LineString', true, 'HeadTails', [trackFrame({ line: 0 })])).toBeNull();
  expect(lineCompanion('LineString', true, 'HeadTails', [trackFrame({ line: 1 })])).toBeNull();
  expect(lineCompanion('LineString', true, 'HeadTails', [trackFrame({ line: 0, points: ['head', 'tail'] })])).toBeNull();
  expect(lineCompanion('LineString', true, '', [trackFrame()])).toBeNull();
});
