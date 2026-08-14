/**
 * Candidate selection across an aligned timeline.
 *
 * Modelled on a real KAMERA flight (2024_AOC_AK_Calibration/fl09, center_view):
 * 277 captures at a 1s cadence, RGB missing 3 of them and IR/UV missing 3
 * different ones, so every modality lands on exactly 274 frames. Equal counts,
 * mismatched timelines -- and because each RGB drop is shadowed by an IR drop
 * one capture later, the local-index offset never re-syncs. Pairing by raw
 * frame index picks images a full cadence apart for all 274 frames; the
 * aligned timeline's slots are what make index i mean one instant.
 */
// eslint-disable-next-line import/no-extraneous-dependencies
import {
  describe, expect, it, vi,
} from 'vitest';
import { ref } from 'vue';
import type { FrameImage } from 'dive-common/apispec';
import { attachFrameTimestamps } from 'dive-common/frameTimestamp';
import { buildAlignedTimeline, AlignedSlot } from 'dive-common/alignedTimeline';
import type CameraRegistrationStore from 'vue-media-annotator/alignedView/CameraRegistrationStore';
import { createAutoRegisterJobService, AlignPipe } from './useAutoRegisterJob';

const BASE_EPOCH_MS = Date.UTC(2024, 5, 12, 20, 40, 5, 0);
const UNION_LENGTH = 277;
const MISSING_FROM_RGB = new Set([93, 189, 276]);
const MISSING_FROM_IR = new Set([0, 94, 190]);
const CAMERAS = ['rgb', 'ir', 'uv'];

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

const ALIGN_PIPE: AlignPipe = {
  name: 'Align Cameras 3-cam', pipe: 'utility_align_cameras_3-cam.pipe', type: 'utility',
};

/** Captures the imagePairs the service would hand the pipeline. */
function buildService(slots: AlignedSlot[] | null) {
  const sent: {
    imagePairs?: Record<string, string[]>;
    kwiverParams?: Record<string, string>;
  } = {};
  const service = createAutoRegisterJobService({
    datasetId: ref('ds1'),
    cameras: ref(CAMERAS),
    frameCount: (camera: string) => IMAGES[camera].length,
    timestampsFor: (camera: string) => IMAGES[camera].map((frame) => frame.timestamp),
    alignedSlots: () => slots,
    resolveImagePaths: async (camera: string, frames: number[]) => (
      frames.map((n) => IMAGES[camera][n]?.filename ?? `missing://${n}`)
    ),
    getPipelineList: async () => ({ utility: { pipes: [ALIGN_PIPE] } }),
    runPipeline: async (_id, _pipe, params) => {
      sent.imagePairs = params.runtimeParams?.imagePairs;
      sent.kwiverParams = params.kwiverParams;
      // Reject so run() settles without entering the result poll loop.
      throw new Error('stop-after-launch');
    },
    loadMetadata: async () => ({ cameraCorrespondences: {} }),
    registration: {
      observations: ref({}),
      dirty: ref(false),
    } as unknown as CameraRegistrationStore,
    confirmReload: async () => true,
  });
  return { service, sent };
}

function timestampOf(camera: string, filename: string): number {
  return IMAGES[camera].find((frame) => frame.filename === filename)?.timestamp as number;
}

describe('auto-register candidate selection', () => {
  const timeline = buildAlignedTimeline(IMAGES);
  const { slots } = (timeline as { aligned: true; slots: AlignedSlot[] });

  it('the fixture reproduces equal counts over mismatched timelines', () => {
    expect(IMAGES.rgb).toHaveLength(274);
    expect(IMAGES.ir).toHaveLength(274);
    const mispaired = IMAGES.rgb.filter(
      (frame, i) => Math.abs((frame.timestamp as number) - (IMAGES.ir[i].timestamp as number)) > 0.5,
    );
    expect(mispaired).toHaveLength(274);
  });

  it('sends one capture per candidate when a timeline is available', async () => {
    const { service, sent } = buildService(slots);
    await service.refreshAvailability();
    await service.run({ maxFrames: 12, candidatesPerBin: 2 });

    const pairs = sent.imagePairs as Record<string, string[]>;
    expect(Object.keys(pairs).sort()).toEqual(['ir', 'rgb', 'uv']);
    expect(pairs.rgb.length).toBeGreaterThan(0);
    pairs.rgb.forEach((name, i) => {
      // Every camera in a candidate must be the same instant.
      expect(timestampOf('ir', pairs.ir[i])).toBe(timestampOf('rgb', name));
      expect(timestampOf('uv', pairs.uv[i])).toBe(timestampOf('rgb', name));
    });
  });

  it('never proposes a capture that is missing on some camera', async () => {
    const { service, sent } = buildService(slots);
    await service.refreshAvailability();
    await service.run({ maxFrames: 24, candidatesPerBin: 4 });

    const pairs = sent.imagePairs as Record<string, string[]>;
    CAMERAS.forEach((camera) => {
      pairs[camera].forEach((name) => expect(name.startsWith('missing://')).toBe(false));
    });
    // Gap captures (union 0/93/94/189/190/276) can never appear.
    const gapStamps = [0, 93, 94, 189, 190, 276]
      .map((i) => (BASE_EPOCH_MS + i * 1000) / 1000);
    pairs.rgb.forEach((name) => {
      expect(gapStamps).not.toContain(timestampOf('rgb', name));
    });
  });

  /**
   * Without the timeline this dataset produces nothing at all: candidates are
   * ranked by inter-camera skew read off raw local indices, every index is a
   * full 1s cadence out, and the 0.5s gate drops all of them. That is the
   * pre-fix behavior a user hit -- "No candidate frames could be proposed" on
   * a flight whose captures are in fact 271-deep.
   */
  it('proposes nothing without a timeline, and never launches', async () => {
    const { service, sent } = buildService(null);
    await service.refreshAvailability();
    await service.run({ maxFrames: 12, candidatesPerBin: 2 });

    expect(sent.imagePairs).toBeUndefined();
    expect(service.error.value).toMatch(/No candidate frames/);
  });
});

/**
 * Queued frames: the user has already chosen the captures, so the stratified
 * proposal (temporal bins, per-bin oversampling, skew ranking) does not apply.
 * Every queued capture is matched; only captures a camera is missing get
 * dropped, because the pipeline reads image lists off disk and a gap has no
 * path to send.
 */
describe('running an explicitly queued frame set', () => {
  const timeline = buildAlignedTimeline(IMAGES);
  const { slots } = (timeline as { aligned: true; slots: AlignedSlot[] });

  it('matches exactly the queued captures, in slot order', async () => {
    const { service, sent } = buildService(slots);
    await service.refreshAvailability();
    await service.run({
      maxFrames: 3, candidatesPerBin: 1, slots: [140, 141, 200],
    });

    const pairs = sent.imagePairs as Record<string, string[]>;
    expect(pairs.rgb).toHaveLength(3);
    // Slot 140 is rgb-local 139 / ir-local 138 (the drops so far).
    expect(pairs.rgb[0]).toBe(IMAGES.rgb[139].filename);
    expect(pairs.ir[0]).toBe(IMAGES.ir[138].filename);
    pairs.rgb.forEach((name, i) => {
      expect(timestampOf('ir', pairs.ir[i])).toBe(timestampOf('rgb', name));
      expect(timestampOf('uv', pairs.uv[i])).toBe(timestampOf('rgb', name));
    });
  });

  it('gives the pipeline one bin per queued frame so none are pruned', async () => {
    const { service, sent } = buildService(slots);
    await service.refreshAvailability();
    await service.run({
      maxFrames: 99, candidatesPerBin: 7, slots: [140, 141, 200],
    });

    // maxFrames/candidatesPerBin are the proposal's knobs and must not leak in.
    expect(sent.kwiverParams?.['register:max_frames']).toBe('3');
  });

  it('drops queued captures a camera is missing', async () => {
    const { service, sent } = buildService(slots);
    await service.refreshAvailability();
    // Slot 0 is RGB-only; 93 has no RGB. Only 140 is registerable.
    await service.run({
      maxFrames: 3, candidatesPerBin: 1, slots: [0, 93, 140],
    });

    const pairs = sent.imagePairs as Record<string, string[]>;
    expect(pairs.rgb).toHaveLength(1);
    expect(pairs.rgb[0]).toBe(IMAGES.rgb[139].filename);
  });

  it('errors rather than launching when no queued capture is registerable', async () => {
    const { service, sent } = buildService(slots);
    await service.refreshAvailability();
    await service.run({ maxFrames: 2, candidatesPerBin: 1, slots: [0, 93] });

    expect(sent.imagePairs).toBeUndefined();
    expect(service.error.value).toMatch(/None of the queued frames/);
  });
});

/**
 * "Replace existing" drops the prior matcher observations from the in-memory
 * store. Those removals are the run's own bookkeeping, so on their own they
 * must not leave the store looking like it holds the user's unsaved edits --
 * otherwise the completion path stops to ask whether to discard edits the
 * user never made, on every single replace-mode run.
 */
describe('replaceExisting and the unsaved-edits baseline', () => {
  const timeline = buildAlignedTimeline(IMAGES);
  const { slots } = (timeline as { aligned: true; slots: AlignedSlot[] });
  const OBSERVATIONS = {
    'rgb::ir': [
      {
        imageA: 'a.jpg', imageB: 'b.png', source: 'minima_loftr', enabled: true, points: [],
      },
      {
        imageA: 'c.jpg', imageB: 'd.png', source: 'hand', enabled: true, points: [],
      },
    ],
  };

  function buildStoreService(dirtyBefore: boolean) {
    const removed: string[] = [];
    const calls = { markSaved: 0 };
    const registration = {
      observations: ref(OBSERVATIONS),
      dirty: ref(dirtyBefore),
      removeObservation: (_key: string, imageA: string, _imageB: string, source: string) => {
        removed.push(`${imageA}:${source}`);
      },
      markSaved: () => { calls.markSaved += 1; },
    } as unknown as CameraRegistrationStore;
    const service = createAutoRegisterJobService({
      datasetId: ref('ds1'),
      cameras: ref(CAMERAS),
      frameCount: (camera: string) => IMAGES[camera].length,
      timestampsFor: (camera: string) => IMAGES[camera].map((frame) => frame.timestamp),
      alignedSlots: () => slots,
      resolveImagePaths: async (camera: string, frames: number[]) => (
        frames.map((n) => IMAGES[camera][n].filename)
      ),
      getPipelineList: async () => ({ utility: { pipes: [ALIGN_PIPE] } }),
      runPipeline: async () => { throw new Error('stop-after-launch'); },
      loadMetadata: async () => ({ cameraCorrespondences: {} }),
      registration,
      confirmReload: async () => true,
    });
    return { service, removed, calls };
  }

  it('re-baselines a clean store so its own removals do not read as edits', async () => {
    const { service, removed, calls } = buildStoreService(false);
    await service.refreshAvailability();
    await service.run({ maxFrames: 6, candidatesPerBin: 2, replaceExisting: true });

    // Only the matcher's own observations are dropped; hand picks survive.
    expect(removed).toEqual(['a.jpg:minima_loftr']);
    expect(calls.markSaved).toBe(1);
  });

  it('leaves a genuinely dirty store dirty', async () => {
    const { service, calls } = buildStoreService(true);
    await service.refreshAvailability();
    await service.run({ maxFrames: 6, candidatesPerBin: 2, replaceExisting: true });

    expect(calls.markSaved).toBe(0);
  });

  it('does not touch the baseline when not replacing', async () => {
    const { service, removed, calls } = buildStoreService(false);
    await service.refreshAvailability();
    await service.run({ maxFrames: 6, candidatesPerBin: 2 });

    expect(removed).toEqual([]);
    expect(calls.markSaved).toBe(0);
  });
});

/**
 * The completion confirm is modal and can sit unanswered indefinitely. While
 * it waits, the panel must not keep claiming the job is still matching frames
 * -- that reads as a hung job when the work is already done and merged.
 */
describe('status while the completion confirm is open', () => {
  const timeline = buildAlignedTimeline(IMAGES);
  const { slots } = (timeline as { aligned: true; slots: AlignedSlot[] });

  it('reports waiting on confirmation rather than "job running"', async () => {
    vi.useFakeTimers();
    try {
      let resolveConfirm: (value: boolean) => void = () => {};
      let confirmOpened = false;
      // Metadata changes after the baseline read, so the first poll tick sees
      // the job's result land and routes into the dirty-store confirm.
      let loads = 0;
      const service = createAutoRegisterJobService({
        datasetId: ref('ds1'),
        cameras: ref(CAMERAS),
        frameCount: (camera: string) => IMAGES[camera].length,
        timestampsFor: (camera: string) => IMAGES[camera].map((frame) => frame.timestamp),
        alignedSlots: () => slots,
        resolveImagePaths: async (camera: string, frames: number[]) => (
          frames.map((n) => IMAGES[camera][n].filename)
        ),
        getPipelineList: async () => ({ utility: { pipes: [ALIGN_PIPE] } }),
        runPipeline: async () => undefined,
        loadMetadata: async () => {
          loads += 1;
          return { cameraCorrespondences: loads > 1 ? { 'rgb::ir': [1] } : {} };
        },
        registration: {
          observations: ref({}),
          dirty: ref(true),
        } as unknown as CameraRegistrationStore,
        confirmReload: () => {
          confirmOpened = true;
          return new Promise<boolean>((resolve) => { resolveConfirm = resolve; });
        },
      });
      await service.refreshAvailability();
      const settled = service.run({ maxFrames: 6, candidatesPerBin: 2 });

      // Launch settles, then the 5s poll tick fires.
      await vi.advanceTimersByTimeAsync(0);
      expect(service.status.value).toMatch(/matching frames/);
      await vi.advanceTimersByTimeAsync(5000);

      expect(confirmOpened).toBe(true);
      expect(service.status.value).toBe('Auto Register finished — confirm loading the results');
      expect(service.status.value).not.toMatch(/job running/);

      resolveConfirm(false);
      await settled;
      expect(service.running.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
