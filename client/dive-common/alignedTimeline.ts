import type { FrameImage } from './apispec';

/**
 * Max time delta, in seconds, between two cameras' frame timestamps for them to
 * be considered "the same instant" (SEAL feature 5). In KAMERA sample data the
 * C/L/R cameras share an identical capture timestamp per shot, so this mainly
 * has to absorb sub-second jitter/rounding; 0.5s leaves margin for less tightly
 * synchronized full-flight captures. Retune if real cadence differs.
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
 * the whole dataset falls back to today's exact positional alignment -- the
 * safe, conservative default for datasets whose filenames don't follow a
 * recognized timestamp convention (see dive_utils/timestamp_parser.py).
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

  // Tie-break equal timestamps by local index BEFORE camera name: when several
  // cameras share identical capture timestamps (e.g. a calibration set where
  // every C/L/R shot carries one collection timestamp), interleaving by index
  // pairs frame i of every camera into the same slot. Camera-name-first
  // ordering would instead sweep all of one camera's same-time frames into
  // consecutive single-camera slots (spill), producing a timeline of mostly
  // blank panes for data that is really positionally aligned.
  triples.sort((a, b) => (
    a.timestamp - b.timestamp
    || a.localIndex - b.localIndex
    || a.camera.localeCompare(b.camera)
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

/**
 * Inverse of a slot lookup: for each camera, maps its own local frame index
 * to the global aligned-timeline slot it appears in. Used to translate a
 * "seek this camera to its own local frame X" request (e.g. jumping to a
 * track's start/end, which is stored in local-frame units) into the correct
 * global slot, so every camera stays aligned instead of just the one camera
 * jumping independently. Each camera appears in at most one slot per local
 * frame (buildAlignedTimeline's first-come-first-served rule), so this is
 * always a 1:1 mapping.
 */
export type InverseAlignedIndex = Record<string, Map<number, number>>;

export function buildInverseAlignedIndex(slots: AlignedSlot[]): InverseAlignedIndex {
  const inverse: InverseAlignedIndex = {};
  slots.forEach((slot, slotIndex) => {
    Object.entries(slot).forEach(([camera, localIndex]) => {
      if (localIndex === undefined) {
        return;
      }
      if (!inverse[camera]) {
        inverse[camera] = new Map();
      }
      inverse[camera].set(localIndex, slotIndex);
    });
  });
  return inverse;
}

/**
 * Builds the CSS linear-gradient that Controls.vue paints under the frame
 * scrubber to mark aligned-timeline gap slots (slots where at least one
 * camera has no frame). Pure so it is unit-testable.
 *
 * Geometry: a v-slider thumb for value v sits at v/maxFrame of the track
 * width, so each gap band is centered on the thumb position for its slot --
 * slot s paints [(s - 0.5) / maxFrame, (s + 0.5) / maxFrame], clamped to
 * [0, 100]. Consecutive gap slots are merged into a single band so the CSS
 * stop count tracks the number of distinct gaps, not the number of gap
 * frames. Bands narrower than `minWidthPct` are widened around their center
 * so single-frame gaps stay visible on long timelines.
 */
export function computeGapGradient(
  gapSlots: number[],
  maxFrame: number,
  minWidthPct = 0.25,
): string {
  if (!gapSlots.length || maxFrame <= 0) {
    return 'none';
  }
  const ranges: [number, number][] = [];
  let rangeStart = gapSlots[0];
  let rangeEnd = gapSlots[0];
  for (let i = 1; i < gapSlots.length; i += 1) {
    if (gapSlots[i] === rangeEnd + 1) {
      rangeEnd = gapSlots[i];
    } else {
      ranges.push([rangeStart, rangeEnd]);
      rangeStart = gapSlots[i];
      rangeEnd = gapSlots[i];
    }
  }
  ranges.push([rangeStart, rangeEnd]);
  const toPct = (frame: number) => (frame / maxFrame) * 100;
  const stops: string[] = [];
  ranges.forEach(([start, end]) => {
    let startPct = Math.max(0, toPct(start - 0.5));
    let endPct = Math.min(100, toPct(end + 0.5));
    if (endPct - startPct < minWidthPct) {
      const mid = (startPct + endPct) / 2;
      startPct = Math.max(0, mid - minWidthPct / 2);
      endPct = Math.min(100, mid + minWidthPct / 2);
    }
    stops.push(`transparent ${startPct}%`, `#ff5252 ${startPct}%`, `#ff5252 ${endPct}%`, `transparent ${endPct}%`);
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/**
 * Global aligned-timeline slot indices where at least one loaded camera has
 * no frame -- i.e. scrubbing to that slot will blank at least one camera's
 * pane. Used to render a gap indicator on the timeline scrubber.
 */
export function computeGapSlots(slots: AlignedSlot[]): number[] {
  const gaps: number[] = [];
  slots.forEach((slot, index) => {
    if (Object.values(slot).some((localIndex) => localIndex === undefined)) {
      gaps.push(index);
    }
  });
  return gaps;
}
