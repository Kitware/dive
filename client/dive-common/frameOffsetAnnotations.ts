import type { TrackData } from 'vue-media-annotator/track';

/**
 * Shift every frame of a serialized track by `delta`, dropping features that
 * would land before frame 0. Returns null when nothing survives.
 */
export function shiftTrackData(track: TrackData, delta: number): TrackData | null {
  if (delta === 0) {
    return track;
  }
  const features = track.features
    .filter((feature) => feature && feature.frame + delta >= 0)
    .map((feature) => ({ ...feature, frame: feature.frame + delta }));
  if (!features.length) {
    return null;
  }
  return {
    ...track,
    features,
    begin: Math.max(0, track.begin + delta),
    end: Math.max(0, track.end + delta),
  };
}

/**
 * Frames each camera's annotations still need to move: its stored time
 * offset minus what was already applied to them. Cameras in step are absent.
 */
export function pendingFrameShifts(
  offsets: Record<string, number>,
  applied: Record<string, number>,
  cameras: string[],
): Record<string, number> {
  const shifts: Record<string, number> = {};
  cameras.forEach((camera) => {
    const delta = (offsets[camera] ?? 0) - (applied[camera] ?? 0);
    if (delta !== 0) {
      shifts[camera] = delta;
    }
  });
  return shifts;
}
