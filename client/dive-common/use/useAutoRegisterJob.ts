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
  /**
   * Explicit global aligned-timeline slots to match, bypassing the stratified
   * proposal. Used by "queue these frames and run": the user has already
   * chosen the captures, so temporal spread and per-bin oversampling do not
   * apply -- every queued capture is matched, and only captures missing a
   * frame on some camera are dropped. maxFrames/candidatesPerBin are ignored.
   */
  slots?: number[];
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
  /**
   * Resolve when the launched job reaches a terminal state, where the platform
   * can report that. Preferred over watching the dataset for the job's output:
   * the matcher is deterministic, so re-running it over the same frames merges
   * byte-identical observations, and a registration that never changes is
   * indistinguishable from a job that is still running (or one that failed and
   * wrote nothing at all).
   */
  watchJob?(datasetId: string, pipe: AlignPipe): Promise<{ ok: boolean; message?: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loadMetadata(datasetId: string): Promise<any>;
  registration: CameraRegistrationStore;
  /**
   * Persist the panel's unsaved registration edits -- the same write its Save
   * button does, and a no-op when the store is clean. Run before the job is
   * launched: see the call site for why the job cannot be started over unsaved
   * state.
   */
  saveRegistration(): Promise<void>;
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

  /** What a finished run left behind, read back off the persisted registration. */
  interface RunSummary {
    /** Camera pairs the matcher produced observations for. */
    pairs: number;
    /** Of those, the ones that came out with a transform. */
    fitted: number;
    /** Rejected-frame counts, keyed by the producer's reason. */
    skipped: Record<string, number>;
  }

  /**
   * Summarize the run from the merged registration.
   *
   * The pipeline already records why it discarded a candidate -- stats.skipped,
   * e.g. low_texture over flat ice or open water -- and DIVE persists that per
   * observation, but nothing read it back: a run that rejected every frame and
   * fitted nothing reported the same "complete" as one that fitted the whole
   * rig, leaving the reason visible only in the job log.
   *
   * Reason counts are per pair rather than summed. Every pair sees the same
   * candidate spread, so summing would report a 14-frame run as 42 rejections
   * on a triplet.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function summarizeRun(meta: any): RunSummary {
    const homographies = meta?.cameraHomographies ?? {};
    const correspondences = meta?.cameraCorrespondences ?? {};
    const summary: RunSummary = { pairs: 0, fitted: 0, skipped: {} };
    Object.entries(correspondences).forEach(([key, rows]) => {
      const matcher = (Array.isArray(rows) ? rows : [])
        .filter((obs) => obs?.source === MATCHER_SOURCE);
      if (!matcher.length) {
        return;
      }
      summary.pairs += 1;
      if (homographies[key]) {
        summary.fitted += 1;
      }
      const perPair: Record<string, number> = {};
      matcher.forEach((obs) => {
        const reason = obs?.stats?.skipped;
        if (obs?.enabled === false && typeof reason === 'string') {
          perPair[reason] = (perPair[reason] ?? 0) + 1;
        }
      });
      Object.entries(perPair).forEach(([reason, count]) => {
        summary.skipped[reason] = Math.max(summary.skipped[reason] ?? 0, count);
      });
    });
    return summary;
  }

  /** "14 low_texture, 2 low_overlap", commonest first; empty when nothing was rejected. */
  function describeSkips(skipped: Record<string, number>): string {
    return Object.entries(skipped)
      .sort(([, a], [, b]) => b - a)
      .map(([reason, count]) => `${count} ${reason}`)
      .join(', ');
  }

  /**
   * Say what the run actually achieved. A run that fitted nothing is a failure
   * however cleanly the job exited, so it reports through `error` -- including
   * on a re-run, where the matcher is deterministic and the merge changes
   * nothing (`unchanged`), which otherwise reads as "already up to date".
   */
  function reportOutcome(summary: RunSummary, unchanged = false) {
    const skips = describeSkips(summary.skipped);
    if (summary.pairs > 0 && summary.fitted === 0) {
      status.value = null;
      error.value = skips
        ? 'Auto Register fitted no camera pairs: every candidate frame was rejected '
          + `(${skips}). Try frames with more visible structure.`
        : 'Auto Register fitted no camera pairs; see the job log for details.';
      return;
    }
    if (unchanged) {
      status.value = 'Auto Register complete: the results matched the registration already stored.';
      return;
    }
    // "N of M fitted" rather than "fitted N of M": a pair may carry a transform
    // this run had no hand in, and claiming it would misreport a partial run.
    status.value = skips
      ? `Auto Register complete: ${summary.fitted} of ${summary.pairs} pair(s) fitted, `
        + `${skips} rejected. Review the registration frames below.`
      : 'Auto Register complete: review the registration frames below.';
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
   * Take the job's merged output into the store. Unsaved in-app edits are never
   * clobbered silently -- the user confirms first. Returns false when the user
   * declined, so the caller can leave its own message up.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function adoptResult(meta: any): Promise<boolean> {
    if (deps.registration.dirty.value) {
      // The confirm is modal and can sit unanswered indefinitely; say so,
      // rather than leaving the panel claiming the job is still matching
      // frames while it is really waiting on the user.
      status.value = 'Auto Register finished — confirm loading the results';
      const confirmed = await deps.confirmReload();
      if (!confirmed) {
        status.value = null;
        error.value = 'Auto Register finished; reload the dataset to see its results.';
        return false;
      }
    }
    rehydrate(meta);
    reportOutcome(summarizeRun(meta));
    return true;
  }

  /**
   * Completion by job state: the platform tells us the job ended, and only then
   * do we look at what it left behind. A run whose results match what is already
   * stored still completes -- that is a real outcome, not a reason to keep
   * waiting.
   */
  async function awaitJobResult(baseline: string): Promise<void> {
    const watchJob = deps.watchJob as NonNullable<AutoRegisterJobDeps['watchJob']>;
    const outcome = await watchJob(deps.datasetId.value, alignPipe.value as AlignPipe);
    if (disposed) {
      return;
    }
    if (!outcome.ok) {
      status.value = null;
      error.value = `Auto Register job did not finish: ${outcome.message ?? 'unknown error'}`;
      return;
    }
    let meta;
    try {
      meta = await deps.loadMetadata(deps.datasetId.value);
    } catch (err) {
      status.value = null;
      error.value = 'Auto Register finished, but the dataset could not be reloaded; reopen it to see the results.';
      return;
    }
    if (JSON.stringify(meta.cameraCorrespondences ?? {}) === baseline) {
      // Same frames, same weights, same points: the merge was a no-op. Say so
      // instead of implying the run did nothing at all -- unless nothing was
      // fitted, in which case the run failed the same way it did last time.
      reportOutcome(summarizeRun(meta), true);
      return;
    }
    await adoptResult(meta);
  }

  /**
   * Fallback for platforms that cannot report job state: watch the dataset's
   * persisted registration until the job's collector merges the pipeline output
   * in. This cannot see a job that failed or one whose output was identical, so
   * it is only used when {@link AutoRegisterJobDeps.watchJob} is absent.
   */
  async function pollForResult(baseline: string) {
    const started = Date.now();
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
      // eslint-disable-next-line no-await-in-loop
      await adoptResult(meta);
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
      // Global slot index -> position in `slots`, so an explicitly queued
      // capture (which the UI names by its global slot) can be located here.
      const positionOfSlot = new Map<number, number>();
      (deps.alignedSlots() ?? []).forEach((slot, globalIndex) => {
        if (cameras.every((camera) => slot[camera] !== undefined)) {
          positionOfSlot.set(globalIndex, slots.length);
          slots.push(slot);
        }
      });
      const aligned = slots.length > 0;
      const queued = options.slots?.length
        ? options.slots
          .map((globalIndex) => (aligned ? positionOfSlot.get(globalIndex) : globalIndex))
          .filter((position): position is number => position !== undefined)
        : null;
      if (options.slots?.length && !queued?.length) {
        throw new Error(
          'None of the queued frames can be registered: no capture in the queue '
          + 'has a frame on every camera.',
        );
      }
      const frames = queued ?? proposeRegistrationFrames({
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
      status.value = queued
        ? `Preparing ${frames.length} queued frame(s)…`
        : `Proposing ${frames.length} candidate frames…`;
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
        const wasDirty = registration.dirty.value;
        Object.entries(registration.observations.value).forEach(([key, list]) => {
          list
            .filter((obs) => obs.source === MATCHER_SOURCE)
            .forEach((obs) => registration.removeObservation(key, obs.imageA, obs.imageB, MATCHER_SOURCE));
        });
        // These removals are this run's own bookkeeping, not the user's
        // edits: left counted as unsaved they would trip the "you have
        // unsaved edits" confirmation at the end of EVERY replace-mode run,
        // asking the user to protect changes they never made. Re-baseline so
        // only genuine hand edits still read dirty (same rule frame
        // resolution follows in CameraRegistrationStore.setFrameResolver).
        if (!wasDirty) {
          registration.markSaved();
        }
      }
      const kwiverParams: Record<string, string> = {
        // max_frames is the pipeline's bin budget: it keeps the best candidate
        // per bin and prunes the rest. A queued run has already chosen its
        // captures, so give it one bin per frame or it would prune them back
        // down to the proposal's budget.
        'register:max_frames': String(queued ? frames.length : options.maxFrames),
      };
      if (options.pairs) {
        kwiverParams['register:pairs'] = options.pairs;
      }
      if (options.minInliers !== undefined) {
        kwiverParams['register:min_inliers'] = String(options.minInliers);
      }
      // Launch from saved state, for two independent reasons.
      // Navigation: the status line below sends the user to the Jobs tab, but
      // the viewer's guard stops them leaving with unsaved registration edits,
      // and the dataset is read-only for the job's duration -- so the prompt
      // would offer only "discard" for work they cannot save.
      // Correctness: the job's output is merged into the SAVED registration
      // (server-side ingest, or the desktop collector), and the result is then
      // rehydrated over the store. Replace mode's local removal of prior
      // matcher observations would be undone by that reload unless it is
      // persisted first.
      status.value = 'Saving registration edits…';
      await deps.saveRegistration();
      // Read the baseline only after the save, or the save itself would look
      // like the job's first result.
      const meta = await deps.loadMetadata(deps.datasetId.value);
      const baseline = JSON.stringify(meta.cameraCorrespondences ?? {});
      // Queueing the job is not the same as the job starting: video frames are
      // extracted to stills first, which is the slowest part of a rig-wide run.
      // Say so, since until that finishes there is no pipeline output to watch.
      status.value = `Starting Auto Register on ${frames.length} frame(s) — preparing inputs…`;
      await deps.runPipeline(deps.datasetId.value, pipe, {
        kwiverParams,
        runtimeParams: { imagePairs },
      });
      status.value = 'Auto Register job running — see the Jobs tab for progress';
      if (deps.watchJob) {
        await awaitJobResult(baseline);
      } else {
        await pollForResult(baseline);
      }
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
