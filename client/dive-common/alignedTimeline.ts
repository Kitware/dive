import type { FrameImage } from './apispec';

/**
 * PROVISIONAL (SEAL feature 5, Phase II): max time delta, in seconds, between
 * two cameras' frame timestamps for them to be considered "the same instant."
 * No real timestamped multicam sample data exists yet (SEALTK_MIGRATION_PLAN.md
 * Q2) -- trivial to retune once real data is available.
 */
export const FRAME_ALIGNMENT_TOLERANCE_SECONDS = 0.5;

/**
 * camera name -> local index into that camera's own FrameImage[], or undefined
 * if no frame from that camera falls within tolerance of this timeline slot.
 */
export type AlignedSlot = Record<string, number | undefined>;

export type TimelineResult =
  | { aligned: true; slots: AlignedSlot[] }
  | { aligned: false };

interface FrameTriple {
  camera: string;
  localIndex: number;
  timestamp: number;
}

/**
 * A dataset qualifies for aligned playback only when there are at least two
 * cameras, every camera has at least one frame, and every frame on every
 * camera has a defined timestamp. A single untimestamped frame anywhere means
 * the whole dataset falls back to today's exact positional alignment -- this
 * is the safe, conservative default until real MML naming conventions (and
 * thus better timestamp coverage) are confirmed.
 */
export function canAlign(camerasFrames: Record<string, FrameImage[]>): boolean {
  const cameraNames = Object.keys(camerasFrames);
  if (cameraNames.length < 2) {
    return false;
  }
  return cameraNames.every((camera) => {
    const frames = camerasFrames[camera];
    return frames.length > 0 && frames.every((frame) => frame.timestamp !== undefined);
  });
}

/**
 * Builds a global aligned timeline from each camera's own frame list, when
 * every frame across every camera carries a timestamp (see canAlign).
 *
 * Algorithm: flatten every camera's frames into (camera, localIndex,
 * timestamp) triples, sort ascending by timestamp (tied by camera name then
 * local index, for determinism), then sweep once: open a slot at the first
 * unassigned triple's timestamp, and absorb subsequent triples within
 * `toleranceSeconds` of that slot's start time as long as that camera isn't
 * already filled in the open slot. Otherwise close the slot and open a new
 * one at that triple. This is deliberately simple (O(n log n), single pass,
 * no bipartite matching) -- appropriate given there's no real data yet to
 * justify anything smarter.
 *
 * One explicit simplification: if a camera has two frames within tolerance of
 * the same open slot's start (e.g. a faster capture rate than other
 * cameras), the second spills into a new slot rather than overwriting the
 * first -- first-come-first-served per camera per slot, not silent data loss.
 */
export function buildAlignedTimeline(
  camerasFrames: Record<string, FrameImage[]>,
  toleranceSeconds: number = FRAME_ALIGNMENT_TOLERANCE_SECONDS,
): TimelineResult {
  if (!canAlign(camerasFrames)) {
    return { aligned: false };
  }

  const cameraNames = Object.keys(camerasFrames);
  const triples: FrameTriple[] = [];
  cameraNames.forEach((camera) => {
    camerasFrames[camera].forEach((frame, localIndex) => {
      // frame.timestamp is guaranteed defined here by canAlign() above
      triples.push({ camera, localIndex, timestamp: frame.timestamp as number });
    });
  });

  triples.sort((a, b) => (
    a.timestamp - b.timestamp
    || a.camera.localeCompare(b.camera)
    || a.localIndex - b.localIndex
  ));

  const slots: AlignedSlot[] = [];
  let openSlot: AlignedSlot | null = null;
  let openSlotStartTime = 0;

  triples.forEach((triple) => {
    const withinTolerance = openSlot !== null
      && triple.timestamp - openSlotStartTime <= toleranceSeconds;
    const cameraAlreadyFilled = openSlot !== null && openSlot[triple.camera] !== undefined;

    if (!withinTolerance || cameraAlreadyFilled) {
      if (openSlot !== null) {
        slots.push(openSlot);
      }
      openSlot = Object.fromEntries(cameraNames.map((camera) => [camera, undefined]));
      openSlotStartTime = triple.timestamp;
    }

    (openSlot as AlignedSlot)[triple.camera] = triple.localIndex;
  });
  if (openSlot !== null) {
    slots.push(openSlot);
  }

  return { aligned: true, slots };
}
