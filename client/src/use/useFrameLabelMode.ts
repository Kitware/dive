import { ref, Ref } from 'vue';
import type CameraStore from '../CameraStore';
import type Track from '../track';
import type { RectBounds } from '../utils';

export interface UseFrameLabelModeParams {
  cameraStore: CameraStore;
  selectedCamera: Ref<string>;
  /** Track types managed by frame label mode, in hotkey order. */
  labels: Readonly<Ref<string[]>>;
  getMaxFrame: () => number;
  getFullFrameBounds: () => RectBounds;
}

/**
 * Frame label mode: rapid whole-frame labeling with event semantics.  Each
 * label press starts a full-frame interval track at the current frame; the
 * previous open segment is truncated, and the new segment extends forward
 * until the next existing segment or the end of the video.  Segments are
 * ordinary tracks (type = label) so filtering, styling, timeline display,
 * export, and frame classifier training all work unchanged.
 */
export default function useFrameLabelMode({
  cameraStore,
  selectedCamera,
  labels,
  getMaxFrame,
  getFullFrameBounds,
}: UseFrameLabelModeParams) {
  const enabled = ref(false);

  function getTrackStore() {
    const store = cameraStore.camMap.value.get(selectedCamera.value)?.trackStore;
    if (!store) {
      throw new Error(`No trackStore for camera ${selectedCamera.value}`);
    }
    return store;
  }

  /** All frame-label segments, ordered by begin frame. */
  function segments(): Track[] {
    const labelSet = new Set(labels.value);
    const result: Track[] = [];
    getTrackStore().annotationMap.forEach((track) => {
      if (labelSet.has(track.getType()[0])) {
        result.push(track);
      }
    });
    return result.sort((a, b) => a.begin - b.begin);
  }

  function fullFrameFeature(frame: number) {
    return {
      frame,
      bounds: getFullFrameBounds(),
      keyframe: true,
      interpolate: true,
    };
  }

  /** Move a segment's end to newEnd, dropping any keyframes beyond it. */
  function truncateSegment(track: Track, newEnd: number) {
    track.setFeature(fullFrameFeature(newEnd));
    const beyond = track.featureIndex.filter((frame) => frame > newEnd);
    beyond.forEach((frame) => track.deleteFeature(frame));
  }

  /**
   * Label frames from `frame` forward until the next segment begins (or the
   * end of the video).  Any segment covering `frame` ends at `frame - 1`.
   */
  function labelFrame(label: string, frame: number): number | null {
    const segs = segments();
    const covering = segs.find((t) => t.begin <= frame && t.end >= frame);
    if (covering && covering.getType()[0] === label) {
      return covering.id;
    }
    if (covering && covering.begin === frame) {
      covering.setType(label);
      return covering.id;
    }
    if (covering) {
      truncateSegment(covering, frame - 1);
    }
    const next = segs.find((t) => t.begin > frame);
    const end = next ? next.begin - 1 : Math.max(getMaxFrame(), frame);
    const store = getTrackStore();
    const track = store.add(frame, label, undefined, cameraStore.getNewTrackId());
    track.setFeature(fullFrameFeature(frame));
    if (end > frame) {
      track.setFeature(fullFrameFeature(end));
    }
    return track.id;
  }

  /** End the segment covering `frame` at `frame - 1` (unlabeled from here). */
  function endLabel(frame: number) {
    const covering = segments().find((t) => t.begin <= frame && t.end >= frame);
    if (!covering) {
      return;
    }
    if (covering.begin === frame) {
      getTrackStore().remove(covering.id);
    } else {
      truncateSegment(covering, frame - 1);
    }
  }

  /** The label active at `frame`, or null when unlabeled. */
  function labelAtFrame(frame: number): string | null {
    const covering = segments().find((t) => t.begin <= frame && t.end >= frame);
    return covering ? covering.getType()[0] : null;
  }

  return {
    enabled,
    labelFrame,
    endLabel,
    labelAtFrame,
  };
}
