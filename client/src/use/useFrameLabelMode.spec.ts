import { ref } from 'vue';
import CameraStore from '../CameraStore';
import useFrameLabelMode from './useFrameLabelMode';

const LABELS = ['event-1', 'event-2', 'possible-event'];
const MAX_FRAME = 100;
const BOUNDS: [number, number, number, number] = [0, 0, 1920, 1080];

function setup() {
  const cameraStore = new CameraStore({ markChangesPending: () => undefined });
  const mode = useFrameLabelMode({
    cameraStore,
    selectedCamera: ref('singleCam'),
    labels: ref(LABELS),
    getMaxFrame: () => MAX_FRAME,
    getFullFrameBounds: () => BOUNDS,
  });
  const { trackStore } = cameraStore.camMap.value.get('singleCam')!;
  return { cameraStore, trackStore, mode };
}

function ranges(trackStore: ReturnType<typeof setup>['trackStore']) {
  const result: [string, number, number][] = [];
  trackStore.annotationMap.forEach((t) => {
    result.push([t.getType()[0], t.begin, t.end]);
  });
  return result.sort((a, b) => a[1] - b[1]);
}

describe('useFrameLabelMode', () => {
  it('creates a segment extending to the end of the video', () => {
    const { trackStore, mode } = setup();
    mode.labelFrame('event-1', 10);
    expect(ranges(trackStore)).toEqual([['event-1', 10, MAX_FRAME]]);
    const track = trackStore.annotationMap.values().next().value!;
    expect(track.featureIndex).toEqual([10, MAX_FRAME]);
    expect(track.features[10].bounds).toEqual(BOUNDS);
    expect(track.features[10].interpolate).toBe(true);
    expect(track.features[MAX_FRAME].keyframe).toBe(true);
  });

  it('truncates the previous segment when a new event begins', () => {
    const { trackStore, mode } = setup();
    mode.labelFrame('event-1', 10);
    mode.labelFrame('event-2', 40);
    expect(ranges(trackStore)).toEqual([
      ['event-1', 10, 39],
      ['event-2', 40, MAX_FRAME],
    ]);
  });

  it('inserts an event between existing segments', () => {
    const { trackStore, mode } = setup();
    mode.labelFrame('event-1', 10);
    mode.labelFrame('event-2', 40);
    mode.labelFrame('possible-event', 20);
    expect(ranges(trackStore)).toEqual([
      ['event-1', 10, 19],
      ['possible-event', 20, 39],
      ['event-2', 40, MAX_FRAME],
    ]);
  });

  it('relabels a segment when pressed at its begin frame', () => {
    const { trackStore, mode } = setup();
    mode.labelFrame('event-1', 10);
    mode.labelFrame('event-2', 40);
    mode.labelFrame('possible-event', 40);
    expect(ranges(trackStore)).toEqual([
      ['event-1', 10, 39],
      ['possible-event', 40, MAX_FRAME],
    ]);
  });

  it('is a no-op when the frame already has that label', () => {
    const { trackStore, mode } = setup();
    mode.labelFrame('event-1', 10);
    mode.labelFrame('event-1', 50);
    expect(ranges(trackStore)).toEqual([['event-1', 10, MAX_FRAME]]);
  });

  it('endLabel truncates or deletes the covering segment', () => {
    const { trackStore, mode } = setup();
    mode.labelFrame('event-1', 10);
    mode.endLabel(50);
    expect(ranges(trackStore)).toEqual([['event-1', 10, 49]]);
    mode.endLabel(10);
    expect(ranges(trackStore)).toEqual([]);
    mode.endLabel(70);
    expect(ranges(trackStore)).toEqual([]);
  });

  it('single-frame segment when the next segment starts on the next frame', () => {
    const { trackStore, mode } = setup();
    mode.labelFrame('event-1', 10);
    mode.labelFrame('event-2', 11);
    mode.labelFrame('possible-event', 10);
    expect(ranges(trackStore)).toEqual([
      ['possible-event', 10, 10],
      ['event-2', 11, MAX_FRAME],
    ]);
    const single = trackStore.annotationMap.get(
      [...trackStore.annotationMap.values()].find((t) => t.begin === 10)!.id,
    )!;
    expect(single.featureIndex).toEqual([10]);
  });

  it('ignores tracks whose type is not in the label set', () => {
    const { cameraStore, trackStore, mode } = setup();
    const fish = trackStore.add(0, 'fish', undefined, cameraStore.getNewTrackId());
    fish.setFeature({
      frame: 0, bounds: [5, 5, 10, 10], keyframe: true, interpolate: false,
    });
    mode.labelFrame('event-1', 0);
    expect(ranges(trackStore)).toEqual([
      ['fish', 0, 0],
      ['event-1', 0, MAX_FRAME],
    ]);
    expect(mode.labelAtFrame(0)).toBe('event-1');
  });

  it('labelAtFrame reports the active label', () => {
    const { mode } = setup();
    expect(mode.labelAtFrame(20)).toBeNull();
    mode.labelFrame('event-1', 10);
    mode.labelFrame('event-2', 40);
    expect(mode.labelAtFrame(5)).toBeNull();
    expect(mode.labelAtFrame(15)).toBe('event-1');
    expect(mode.labelAtFrame(40)).toBe('event-2');
    expect(mode.labelAtFrame(MAX_FRAME)).toBe('event-2');
  });
});
