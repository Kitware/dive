import Track from '../../track';
import { FrameDataTrack } from '../LayerTypes';
import TailLayer from './TailLayer';

describe('TailLayer hierarchy display', () => {
  it('carries FrameDataTrack.styleType instead of reading raw pair zero', () => {
    const track = new Track(1, {
      confidencePairs: [['root', 0.9], ['leaf', 0.7]],
      features: [{ frame: 0, bounds: [0, 0, 10, 10], keyframe: true }],
    });
    const layer = Object.create(TailLayer.prototype) as TailLayer;
    Object.assign(layer, {
      currentFrame: 0,
      before: 10,
      after: 5,
      trackStore: { get: () => track },
    });
    const frameData: FrameDataTrack = {
      selected: false,
      editing: false,
      track,
      groups: [],
      features: track.getFeature(0)[0],
      styleType: ['leaf', 0.7],
      trackStyleType: ['leaf', 0.7],
    };
    expect(layer.generateDataForTrack(frameData)[0].styleType).toEqual(['leaf', 0.7]);
  });
});
