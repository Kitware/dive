import lineBoxCompanionTracks from './lineBoxCompanion';
import type { FrameDataTrack } from '../../layers/LayerTypes';

function trackFrame(options: { bounds?: boolean; line?: number; key?: string } = {}): FrameDataTrack {
  const { bounds = true, line = 2, key = 'HeadTails' } = options;
  return {
    features: {
      frame: 0,
      bounds: bounds ? [0, 0, 10, 10] : undefined,
      geometry: {
        type: 'FeatureCollection',
        features: line ? [{
          type: 'Feature',
          properties: { key },
          geometry: { type: 'LineString', coordinates: Array.from({ length: line }, (_, i) => [i, i]) },
        }] : [],
      },
    },
  } as unknown as FrameDataTrack;
}

it('offers the box only while an existing line is edited with boxes visible', () => {
  const tracks = [trackFrame()];
  expect(lineBoxCompanionTracks('LineString', true, 'HeadTails', tracks)).toEqual(tracks);
  expect(lineBoxCompanionTracks('LineString', false, 'HeadTails', tracks)).toEqual([]);
  expect(lineBoxCompanionTracks('rectangle', true, 'HeadTails', tracks)).toEqual([]);
  expect(lineBoxCompanionTracks(false, true, 'HeadTails', tracks)).toEqual([]);
});

it('waits for the line to exist so box handles cannot interrupt drawing it', () => {
  expect(lineBoxCompanionTracks('LineString', true, 'HeadTails', [trackFrame({ line: 0 })])).toEqual([]);
  expect(lineBoxCompanionTracks('LineString', true, 'HeadTails', [trackFrame({ line: 1 })])).toEqual([]);
  expect(lineBoxCompanionTracks('LineString', true, '', [trackFrame()])).toEqual([]);
  expect(lineBoxCompanionTracks('LineString', true, 'HeadTails', [trackFrame({ bounds: false })])).toEqual([]);
});
