/**
 * Cross-camera frame translation for registration UI (markers, seeks).
 *
 * Registration observations resolve their frame in the pair's camA space, but
 * the Timeline draws -- and handler.seekFrame() seeks -- in the SELECTED
 * camera's space. Cameras drop frames independently, so those spaces drift
 * apart and everything drawn from an observation lands a frame or two off.
 *
 * Fixture is the real KAMERA fl09 center_view shape: 277 captures at 1s, RGB
 * missing 3 of them, IR/UV missing 3 different ones, so each modality has
 * exactly 274 frames over mismatched timelines.
 */
// eslint-disable-next-line import/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import type { FrameImage } from 'dive-common/apispec';
import { attachFrameTimestamps } from 'dive-common/frameTimestamp';
import {
  buildAlignedTimeline, buildInverseAlignedIndex, AlignedSlot,
} from 'dive-common/alignedTimeline';

const BASE_EPOCH_MS = Date.UTC(2024, 5, 12, 20, 40, 5, 0);
const UNION_LENGTH = 277;
const MISSING_FROM_RGB = new Set([93, 189, 276]);
const MISSING_FROM_IR = new Set([0, 94, 190]);

function frameName(unionIndex: number, modality: string, ext: string): string {
  const iso = new Date(BASE_EPOCH_MS + unionIndex * 1000).toISOString();
  const date = iso.slice(0, 10).replace(/-/g, '');
  const time = iso.slice(11, 19).replace(/:/g, '');
  return `kamera_calibration_fl09_C_${date}_${time}.607980_${modality}.${ext}`;
}

function cameraFrames(missing: Set<number>, modality: string, ext: string): FrameImage[] {
  const frames: FrameImage[] = [];
  for (let i = 0; i < UNION_LENGTH; i += 1) {
    if (!missing.has(i)) {
      frames.push({ url: '', filename: frameName(i, modality, ext) });
    }
  }
  attachFrameTimestamps(frames);
  return frames;
}

const IMAGES: Record<string, FrameImage[]> = {
  rgb: cameraFrames(MISSING_FROM_RGB, 'rgb', 'jpg'),
  ir: cameraFrames(MISSING_FROM_IR, 'ir', 'png'),
  uv: cameraFrames(MISSING_FROM_IR, 'uv', 'jpg'),
};

const timeline = buildAlignedTimeline(IMAGES) as { aligned: true; slots: AlignedSlot[] };
const { slots } = timeline;
const inverse = buildInverseAlignedIndex(slots);

/** The production implementation, mirrored (useMediaController.aggregateTranslateCameraFrame). */
function translateCameraFrame(from: string, localFrame: number, to: string): number | undefined {
  if (from === to) {
    return localFrame;
  }
  const slot = inverse[from]?.get(localFrame);
  return slot === undefined ? undefined : slots[slot][to];
}

function stamp(camera: string, localFrame: number): number {
  return IMAGES[camera][localFrame].timestamp as number;
}

describe('registration marker frame translation', () => {
  it('untranslated camA frames land on the wrong capture in another camera', () => {
    // What the markers did before: draw the camA-local index as-is.
    const wrong = IMAGES.rgb.filter((frame, rgbLocal) => (
      IMAGES.ir[rgbLocal] !== undefined
      && stamp('ir', rgbLocal) !== (frame.timestamp as number)
    ));
    expect(wrong.length).toBe(274);
  });

  it('translates every camA frame onto the same capture in the target camera', () => {
    let translated = 0;
    IMAGES.rgb.forEach((frame, rgbLocal) => {
      const irLocal = translateCameraFrame('rgb', rgbLocal, 'ir');
      if (irLocal !== undefined) {
        expect(stamp('ir', irLocal)).toBe(frame.timestamp);
        translated += 1;
      }
    });
    // 271 shared captures; the 3 RGB-only frames have no IR counterpart.
    expect(translated).toBe(271);
  });

  it('returns undefined for a capture the target camera is missing', () => {
    // Union 0 is RGB-only -> rgb local 0 has no IR frame.
    expect(translateCameraFrame('rgb', 0, 'ir')).toBeUndefined();
    const missing = IMAGES.rgb.filter(
      (_, i) => translateCameraFrame('rgb', i, 'ir') === undefined,
    );
    expect(missing).toHaveLength(3);
  });

  it('is identity for the same camera', () => {
    expect(translateCameraFrame('ir', 42, 'ir')).toBe(42);
  });

  it('agrees in both directions', () => {
    IMAGES.ir.forEach((_, irLocal) => {
      const rgbLocal = translateCameraFrame('ir', irLocal, 'rgb');
      if (rgbLocal !== undefined) {
        expect(translateCameraFrame('rgb', rgbLocal, 'ir')).toBe(irLocal);
      }
    });
  });

  it('is a passthrough between cameras with identical timelines (ir/uv)', () => {
    IMAGES.ir.forEach((_, irLocal) => {
      expect(translateCameraFrame('ir', irLocal, 'uv')).toBe(irLocal);
    });
  });
});

/**
 * The frame readout above the timeline shows the aggregate controller's frame,
 * which under an aligned timeline is the global slot. A registration frame
 * number derived from camA is in camA's local space, so displaying it raw puts
 * two different numbers on one capture -- both correctly "selected", which is
 * what makes the disagreement so confusing.
 */
describe('registration frame numbers shown in slot space', () => {
  /** The production lookup (useMediaController.aggregateCameraFrameToSlot). */
  function cameraFrameToSlot(camera: string, localFrame: number): number | undefined {
    return inverse[camera]?.get(localFrame);
  }

  it('camA-local and the slot readout disagree by the drops so far', () => {
    // Slot 140 is the reported case: rgb is one frame behind, ir/uv two.
    expect(slots[140]).toEqual({ rgb: 139, ir: 138, uv: 138 });
    expect(cameraFrameToSlot('rgb', 139)).toBe(140);
    expect(cameraFrameToSlot('ir', 138)).toBe(140);
  });

  it('publishes every camera onto the one number the readout shows', () => {
    slots.forEach((slot, slotIndex) => {
      Object.entries(slot).forEach(([camera, localFrame]) => {
        if (localFrame !== undefined) {
          expect(cameraFrameToSlot(camera, localFrame)).toBe(slotIndex);
        }
      });
    });
  });

  it('disagrees for most of the flight if left untranslated', () => {
    const mismatched = slots.filter((slot, slotIndex) => (
      slot.rgb !== undefined && slot.rgb !== slotIndex
    ));
    // Every capture after the first RGB-only frame is off by at least one.
    expect(mismatched.length).toBeGreaterThan(180);
  });
});
