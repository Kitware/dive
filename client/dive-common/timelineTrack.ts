import type Track from 'vue-media-annotator/track';
import type { TimelineFeature } from 'vue-media-annotator/use/useEventChart';

/** A camera's local frame on the playback timeline, or undefined when it has no slot. */
export type CameraFrameToSlot = (camera: string, localFrame: number) => number | undefined;

/**
 * A track's first and last timeline slot across every camera it appears on.
 *
 * Each camera stores its features in its own frame numbering, which differs from
 * the timeline's slots once cameras are aligned by timestamp or time offset, so a
 * min/max over the raw frames would place the track on the wrong slots.
 */
export function timelineRange(
  replicas: [string, Track][],
  toSlot: CameraFrameToSlot,
): [number, number] | null {
  let begin = Infinity;
  let end = -Infinity;
  replicas.forEach(([camera, track]) => {
    [track.begin, track.end].forEach((frame) => {
      const slot = toSlot(camera, frame);
      if (slot !== undefined) {
        begin = Math.min(begin, slot);
        end = Math.max(end, slot);
      }
    });
  });
  return begin <= end ? [begin, end] : null;
}

/** Every feature of a track as timeline slots, merged across cameras and sorted. */
export function timelineFeatures(
  replicas: [string, Track][],
  toSlot: CameraFrameToSlot,
): TimelineFeature[] {
  const bySlot = new Map<number, TimelineFeature>();
  replicas.forEach(([camera, track]) => {
    track.featureIndex.forEach((frame) => {
      const feature = track.features[frame];
      const slot = toSlot(camera, frame);
      if (!feature || slot === undefined) return;
      const existing = bySlot.get(slot);
      bySlot.set(slot, {
        frame: slot,
        keyframe: Boolean(feature.keyframe) || Boolean(existing?.keyframe),
        interpolate: Boolean(feature.interpolate) || Boolean(existing?.interpolate),
      });
    });
  });
  return [...bySlot.values()].sort((a, b) => a.frame - b.frame);
}
