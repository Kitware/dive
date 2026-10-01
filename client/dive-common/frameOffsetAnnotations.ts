import type { TrackData } from 'vue-media-annotator/track';
import type { GroupData } from 'vue-media-annotator/Group';

/** Shift a track's frames by `delta`, dropping those before 0; null if none survive. */
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
    begin: features[0].frame,
    end: features[features.length - 1].frame,
  };
}

/** Shift a group's member ranges by `delta`, clipping at 0; null if no member survives. */
export function shiftGroupData(group: GroupData, delta: number): GroupData | null {
  if (delta === 0) {
    return group;
  }
  const members: GroupData['members'] = {};
  Object.entries(group.members).forEach(([memberId, member]) => {
    const ranges = member.ranges
      .filter(([, end]) => end + delta >= 0)
      .map(([begin, end]) => [Math.max(0, begin + delta), end + delta] as [number, number]);
    if (ranges.length) {
      members[Number(memberId)] = { ...member, ranges };
    }
  });
  const allRanges = Object.values(members).flatMap((member) => member.ranges);
  if (!allRanges.length) {
    return null;
  }
  return {
    ...group,
    members,
    begin: Math.min(...allRanges.map(([begin]) => begin)),
    end: Math.max(...allRanges.map(([, end]) => end)),
  };
}

/** Shift keyed tracks and groups by `delta`; `dropped` counts those left empty. */
export function shiftAnnotationRecords<T extends TrackData, G extends GroupData>(
  tracks: Record<string, T>,
  groups: Record<string, G>,
  delta: number,
): { tracks: Record<string, T>; groups: Record<string, G>; dropped: number } {
  let dropped = 0;
  const shiftedTracks: Record<string, T> = {};
  Object.entries(tracks).forEach(([id, track]) => {
    const shifted = shiftTrackData(track, delta) as T | null;
    if (shifted === null) {
      dropped += 1;
    } else {
      shiftedTracks[id] = shifted;
    }
  });
  const shiftedGroups: Record<string, G> = {};
  Object.entries(groups).forEach(([id, group]) => {
    const shifted = shiftGroupData(group, delta) as G | null;
    if (shifted === null) {
      dropped += 1;
    } else {
      shiftedGroups[id] = shifted;
    }
  });
  return { tracks: shiftedTracks, groups: shiftedGroups, dropped };
}

/** Per-camera offset not yet applied to its annotations; cameras in step are omitted. */
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
