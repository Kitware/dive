import {
  computed, inject, provide, ref, Ref,
} from 'vue';
import type CameraRegistrationStore from 'vue-media-annotator/alignedView/CameraRegistrationStore';
import proposeRegistrationFrames from 'dive-common/autoRegisterSelection';
import type { AlignedSlot } from 'dive-common/alignedTimeline';

/**
 * Auto-register job bridge for the Camera Registration panel.
 *
 * Replaces the old single-frame interactive-service bridge: registration is
 * now computed from MANY image pairs by the `utility_align_cameras_{2,3}-cam`
 * pipeline (one job per rig; a triplet registers in one job). The panel
 * calls {@link AutoRegisterJobService.run} with the knobs worth changing;
 * the service proposes a stratified candidate spread (DIVE picks for
 * diversity and synchronization; the VIAME process picks for image quality
 * within each temporal bin), launches the pipeline with the frame subset,
 * and refreshes the registration store when the job's output lands in the
 * dataset. Availability is "is the align pipe in the pipeline list" -- the
 * add-on packaging makes pipe present <=> weights present by construction,
 * so no separate weights probe exists (and none could work on web).
 */

/** Minimal pipe shape from the pipeline list (see apispec Pipe). */
export interface AlignPipe {
  name: string;
  pipe: string;
  type: string;
}

export interface AutoRegisterRunOptions {
  /** Candidate frames proposed per temporal bin (oversampling factor). */
  candidatesPerBin: number;
  /** Temporal bins == the pipeline's max_frames budget. */
  maxFrames: number;
  /**
   * Camera pairs for a triplet as 1-based input indices ("1-2,1-3,2-3").
   * Undefined = all pairs (the pipe default).
   */
  pairs?: string;
  /** Per-frame minimum-inlier gate override. */
  minInliers?: number;
  /**
   * Drop existing matcher-produced observations for the rig's pairs before
   * launching, so the job's results replace them outright instead of
   * merging over them frame by frame.
   */
  replaceExisting?: boolean;
}

export interface AutoRegisterJobService {
  /** Whether the align pipeline is installed (reactive; resolves after mount). */
  available: Readonly<Ref<boolean>>;
  running: Readonly<Ref<boolean>>;
  /** Progress/status line for the panel, or null when idle. */
  status: Readonly<Ref<string | null>>;
  error: Readonly<Ref<string | null>>;
  run(options: AutoRegisterRunOptions): Promise<void>;
}

/** Everything the host (Viewer) must supply to build the service. */
export interface AutoRegisterJobDeps {
  datasetId: Ref<string>;
  /** Rig cameras in display order (the job is rig-wide). */
  cameras: Ref<string[]>;
  frameCount(camera: string): number;
  /** Per-frame capture timestamps for skew ranking, or null when unknown. */
  timestampsFor(camera: string): (number | undefined)[] | null;
  /**
   * The dataset's aligned timeline (alignedTimeline.ts), or null when the
   * dataset does not qualify for it. Cameras drop frames independently, so one
   * frame index does NOT mean the same capture on every camera -- the slots are
   * what say which local frames belong to one instant. Null falls back to
   * positional pairing, which is all an unaligned dataset supports.
   */
  alignedSlots(): AlignedSlot[] | null;
  /**
   * Resolve the platform image identifiers for a camera's frames (absolute
   * paths on desktop, image names on web, frame://N for video).
   */
  resolveImagePaths(camera: string, frames: number[]): Promise<string[]>;
  getPipelineList(): Promise<Record<string, { pipes: AlignPipe[] }>>;
  runPipeline(datasetId: string, pipe: AlignPipe, params: {
    kwiverParams?: Record<string, string>;
    runtimeParams?: { imagePairs?: Record<string, string[]> };
  }): Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loadMetadata(datasetId: string): Promise<any>;
  registration: CameraRegistrationStore;
  /** Confirm replacing unsaved in-app edits with the job's result. */
  confirmReload(): Promise<boolean>;
}

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000;
const MATCHER_SOURCE = 'minima_loftr';

export function createAutoRegisterJobService(deps: AutoRegisterJobDeps): AutoRegisterJobService & {
  refreshAvailability(): Promise<void>;
  dispose(): void;
} {
  const alignPipe = ref<AlignPipe | null>(null);
  const running = ref(false);
  const status = ref<string | null>(null);
  const error = ref<string | null>(null);
  let disposed = false;

  async function refreshAvailability() {
    // The 2/3-cam pipes install together (one add-on pack); resolve the one
    // matching this rig's camera count.
    const wanted = `utility_align_cameras_${Math.min(deps.cameras.value.length, 3)}-cam.pipe`;
    try {
      const categories = await deps.getPipelineList();
      alignPipe.value = Object.values(categories)
        .flatMap((category) => category.pipes)
        .find((pipe) => pipe.pipe === wanted) ?? null;
    } catch {
      alignPipe.value = null;
    }
  }

  /** Re-hydrate the store from freshly persisted meta, keeping the panel's pair. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function rehydrate(meta: any) {
    const { registration } = deps;
    const priorPair = registration.activePair.value;
    registration.hydrate(
      meta.cameraHomographies,
      meta.cameraCorrespondences,
      meta.cameraTransformTypes,
      meta.cameraRegistrationSource,
    );
    if (priorPair) {
      registration.setActivePair(priorPair.camA, priorPair.camB);
    }
  }

  /**
   * Watch the dataset's persisted registration until the job's collector
   * merges the pipeline output in (there is no cross-platform job-completion
   * event; the artifact itself is the signal). Unsaved in-app edits are
   * never clobbered silently -- the user confirms first.
   */
  async function pollForResult(baseline: string) {
    const started = Date.now();
    status.value = 'Auto Register job running… matching frames';
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, POLL_INTERVAL_MS); });
      if (disposed) {
        return;
      }
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        status.value = null;
        error.value = 'Auto Register timed out waiting for results; check the job log.';
        return;
      }
      let meta;
      try {
        // eslint-disable-next-line no-await-in-loop
        meta = await deps.loadMetadata(deps.datasetId.value);
      } catch {
        // eslint-disable-next-line no-continue
        continue;
      }
      const snapshot = JSON.stringify(meta.cameraCorrespondences ?? {});
      if (snapshot === baseline) {
        // eslint-disable-next-line no-continue
        continue;
      }
      if (deps.registration.dirty.value) {
        // eslint-disable-next-line no-await-in-loop
        const confirmed = await deps.confirmReload();
        if (!confirmed) {
          status.value = null;
          error.value = 'Auto Register finished; reload the dataset to see its results.';
          return;
        }
      }
      rehydrate(meta);
      status.value = 'Auto Register complete: review the registration frames below.';
      return;
    }
  }

  async function run(options: AutoRegisterRunOptions) {
    if (running.value) {
      return;
    }
    const pipe = alignPipe.value;
    if (!pipe) {
      error.value = 'The align_cameras pipeline is not installed (ALIGN-CAMERAS add-on).';
      return;
    }
    running.value = true;
    error.value = null;
    try {
      const cameras = deps.cameras.value;
      const localTimestamps = cameras.map((camera) => deps.timestampsFor(camera));
      // Only slots holding a frame from every camera can be registered: the
      // matcher needs the whole set, and the pipeline reads the image lists off
      // disk, so a gap has no path to send. Gaps stay in the dataset and stay
      // visible in the viewer -- they are simply not candidates.
      const slots: AlignedSlot[] = [];
      (deps.alignedSlots() ?? []).forEach((slot) => {
        if (cameras.every((camera) => slot[camera] !== undefined)) {
          slots.push(slot);
        }
      });
      const aligned = slots.length > 0;
      const frames = proposeRegistrationFrames({
        // With a timeline, "frame i" means slot i -- one capture across the
        // rig. Without one, it falls back to the raw per-camera index.
        counts: aligned
          ? cameras.map(() => slots.length)
          : cameras.map((camera) => deps.frameCount(camera)),
        timestamps: (() => {
          if (!localTimestamps.every((list) => list !== null)) {
            return undefined;
          }
          const lists = localTimestamps as (number | undefined)[][];
          return aligned
            ? cameras.map((camera, i) => slots.map((slot) => lists[i][slot[camera] as number]))
            : lists;
        })(),
        bins: options.maxFrames,
        perBin: options.candidatesPerBin,
      });
      if (frames.length === 0) {
        throw new Error(aligned
          ? 'No candidate frames could be proposed: no capture has a frame on every camera.'
          : 'No candidate frames could be proposed for this dataset.');
      }
      status.value = `Proposing ${frames.length} candidate frames…`;
      const imagePairs: Record<string, string[]> = {};
      // eslint-disable-next-line no-restricted-syntax
      for (const camera of cameras) {
        // Translate each chosen capture into THIS camera's own local frame
        // index; reusing one index across cameras is what paired mismatched
        // instants before.
        const localFrames = aligned
          ? frames.map((slotIndex) => slots[slotIndex][camera] as number)
          : frames;
        // eslint-disable-next-line no-await-in-loop
        imagePairs[camera] = await deps.resolveImagePaths(camera, localFrames);
      }
      if (options.replaceExisting) {
        // Drop prior matcher observations so the fresh run replaces rather
        // than merges; hand-picked observations always survive.
        const { registration } = deps;
        Object.entries(registration.observations.value).forEach(([key, list]) => {
          list
            .filter((obs) => obs.source === MATCHER_SOURCE)
            .forEach((obs) => registration.removeObservation(key, obs.imageA, obs.imageB, MATCHER_SOURCE));
        });
      }
      const kwiverParams: Record<string, string> = {
        'register:max_frames': String(options.maxFrames),
      };
      if (options.pairs) {
        kwiverParams['register:pairs'] = options.pairs;
      }
      if (options.minInliers !== undefined) {
        kwiverParams['register:min_inliers'] = String(options.minInliers);
      }
      const meta = await deps.loadMetadata(deps.datasetId.value);
      const baseline = JSON.stringify(meta.cameraCorrespondences ?? {});
      await deps.runPipeline(deps.datasetId.value, pipe, {
        kwiverParams,
        runtimeParams: { imagePairs },
      });
      await pollForResult(baseline);
    } catch (err) {
      status.value = null;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      running.value = false;
    }
  }

  return {
    available: computed(() => alignPipe.value !== null),
    running,
    status,
    error,
    run,
    refreshAvailability,
    dispose() { disposed = true; },
  };
}

const AutoRegisterJobSymbol = Symbol('autoRegisterJob');

export function provideAutoRegisterJob(service: AutoRegisterJobService) {
  provide(AutoRegisterJobSymbol, service);
}

export function useAutoRegisterJob(): AutoRegisterJobService | null {
  return inject<AutoRegisterJobService | null>(AutoRegisterJobSymbol, null);
}
