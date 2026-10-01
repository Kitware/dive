import Track from 'vue-media-annotator/track';
import { buildInverseAlignedIndex, buildOffsetTimeline } from './alignedTimeline';
import { timelineFeatures, timelineRange } from './timelineTrack';

function makeTrack(frames: number[], keyframes = frames) {
  const features: ConstructorParameters<typeof Track>[1]['features'] = [];
  frames.forEach((frame) => {
    const keyframe = keyframes.includes(frame);
    features[frame] = keyframe ? { frame, bounds: [0, 0, 10, 10], keyframe } : { frame, keyframe };
  });
  return new Track(1, {
    begin: Math.min(...frames), end: Math.max(...frames), features,
  });
}

function offsetToSlot(counts: Record<string, number>, offsets: Record<string, number>) {
  const timeline = buildOffsetTimeline(counts, offsets);
  if (!timeline.aligned) throw new Error('expected an aligned timeline');
  const inverse = buildInverseAlignedIndex(timeline.slots);
  return (camera: string, frame: number) => inverse[camera]?.get(frame);
}

describe('timelineTrack', () => {
  const toSlot = offsetToSlot({ EO: 10, IR: 10, UV: 10 }, { IR: 1 });

  it('places a track on the slots its frames play at, not its stored frame numbers', () => {
    const eo = makeTrack([1, 2]);
    expect(timelineRange([['EO', eo]], toSlot)).toEqual([2, 3]);
    expect(timelineFeatures([['EO', eo]], toSlot).map((f) => f.frame)).toEqual([2, 3]);
  });

  it('merges replicas that share an instant into one slot', () => {
    const eo = makeTrack([1]);
    const ir = makeTrack([2]);
    expect(timelineRange([['EO', eo], ['IR', ir]], toSlot)).toEqual([2, 2]);
    expect(timelineFeatures([['EO', eo], ['IR', ir]], toSlot)).toEqual([
      { frame: 2, keyframe: true, interpolate: false },
    ]);
  });

  it('keeps a slot a keyframe if any camera has a keyframe there', () => {
    const eo = makeTrack([1, 3], [1]);
    const ir = makeTrack([4], [4]);
    expect(timelineFeatures([['EO', eo], ['IR', ir]], toSlot)).toEqual([
      { frame: 2, keyframe: true, interpolate: false },
      { frame: 4, keyframe: true, interpolate: false },
    ]);
  });

  it('skips frames that fall outside the timeline and returns null when none remain', () => {
    const none = () => undefined;
    expect(timelineRange([['EO', makeTrack([1])]], none)).toBeNull();
    expect(timelineFeatures([['EO', makeTrack([1])]], none)).toEqual([]);
  });
});
