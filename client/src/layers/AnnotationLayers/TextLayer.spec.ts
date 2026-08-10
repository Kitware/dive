/// <reference types="vitest" />
import Group from '../../Group';
import Track from '../../track';
import { FrameDataTrack } from '../LayerTypes';
import { defaultFormatter } from './TextLayer';

const styling = {
  color: () => '',
  strokeWidth: () => 1,
  fill: () => false,
  opacity: () => 1,
  labelSettings: () => ({ showLabel: true, showConfidence: true }),
  annotationSetColor: () => '',
};

function makeAnnotation(styleType: [string, number]): FrameDataTrack {
  const track = new Track(1, {
    confidencePairs: [['root', 0.9], ['leaf', 0.7]],
    features: [{ frame: 0, bounds: [0, 0, 10, 10], keyframe: true }],
  });
  const group = new Group(2, { confidencePairs: [['school', 1]], members: {} });
  return {
    selected: false,
    editing: false,
    track,
    groups: [group],
    features: track.getFeature(0)[0],
    styleType,
    trackStyleType: ['leaf', 0.7],
  };
}

describe('TextLayer hierarchy display', () => {
  it('uses the selected track style type as a grouped-label prefix', () => {
    const rows = defaultFormatter(makeAnnotation(['leaf', 0.7]), styling);
    expect(rows?.[0]).toMatchObject({
      type: 'leaf',
      confidence: 1,
      text: 'leaf::school: 1.00',
    });
  });

  it('prefixes the grouped label with the track type while coloring by group', () => {
    const rows = defaultFormatter(makeAnnotation(['school', 1]), styling);
    expect(rows?.[0]).toMatchObject({
      type: 'school',
      confidence: 1,
      text: 'leaf::school: 1.00',
    });
  });
});
