import {
  ref, computed, Ref, ComputedRef,
} from 'vue';
import {
  invert3, applyHomography, Matrix3, Point,
} from './homography';
import {
  TransformType, TRANSFORM_TYPES, DEFAULT_TRANSFORM_TYPE, minPointsForTransform, estimateTransform,
} from './transform';

/** Reserved {@link CorrespondenceObservation.source} value for hand-picked points. */
export const MANUAL_SOURCE = 'manual';

/** One picked/matched point pair inside an observation. `a` is the point in
 * the left camera (camA), `b` the right camera (camB), in native pixels. */
export interface CorrespondencePoint {
  id: number;
  a: Point;
  b: Point;
}

/**
 * A single point pair in the flat per-point view (see
 * {@link CameraRegistrationStore.correspondencesForFrame}). Carries its
 * observation's identity so a point is always attributable to the image pair
 * it was picked on.
 */
export interface Correspondence extends CorrespondencePoint {
  /** The image pair this was picked on -- the persisted identity. */
  imageA: string;
  imageB: string;
  /**
   * Dataset-local frame index, RESOLVED from imageA/imageB at load time.
   * null when the images aren't in this dataset (e.g. a rig registration
   * carried over from another deployment) -- such points simply don't render.
   */
  frame: number | null;
  /**
   * Producer of this point: 'manual' for hand-picked, else a matcher/producer
   * id ('minima_loftr'; KAMERA writes its own). Shared by every point in an
   * observation -- provenance lives at observation granularity.
   */
  source: string;
}

/**
 * Free-form per-observation quality statistics, written by a producer (the
 * align_cameras pipeline reports numMatches / numInliers / inlierRatio /
 * rmsPx / coverage / textureScore, and `skipped` with a machine-readable
 * reason for rejected candidates). Never interpreted structurally by the
 * store -- preserved verbatim through round trips and surfaced by the
 * review UI.
 */
export type ObservationStats = Record<string, unknown>;

/**
 * A correspondence observation: the points contributed by ONE image pair of
 * a camera pair. The image names are the identity; the frame index is
 * derived from them at load time. This is the granularity at which
 * provenance (`source`), the fit-inclusion toggle (`enabled`), and producer
 * statistics live.
 */
export interface CorrespondenceObservation {
  /** Image (or `frame://N` pseudo-image for video) shown by camA. */
  imageA: string;
  /** Image shown by camB. */
  imageB: string;
  /** Resolved dataset-local frame index (camA's frame space), or null. */
  frame: number | null;
  /** Whether this observation's points participate in the pooled fit. */
  enabled: boolean;
  /** Producer id: {@link MANUAL_SOURCE} or a matcher/producer name. */
  source: string;
  /** Producer-reported quality statistics, if any. */
  stats?: ObservationStats;
  points: CorrespondencePoint[];
}

/** Observations keyed by {@link CameraRegistrationStore.pairKey}. */
export type CameraObservations = Record<string, CorrespondenceObservation[]>;

/** Both directions of the fitted alignment transform for one camera pair. */
export interface PairHomography {
  /** Maps left (camA) image coordinates onto right (camB). */
  AtoB: Matrix3;
  /** Maps right (camB) image coordinates onto left (camA). */
  BtoA: Matrix3;
}

/** Fitted transforms keyed by {@link CameraRegistrationStore.pairKey}. */
export type CameraHomographies = Record<string, PairHomography>;

/**
 * Where a pair's homography came from: fitted in-app from picked points, or
 * loaded from a calibration file (which may carry no points at all). Loaded
 * homographies persist through refit checks that would otherwise clear an
 * under-pointed pair, until enough points are picked to fit a replacement.
 */
type HomographySource = 'fit' | 'loaded';

/**
 * Free-form provenance stamped into the calibration file by whatever produced
 * the transforms (e.g. an external COLMAP/KAMERA model step: model version,
 * swathe/flight id, generation time). DIVE never interprets it -- it is
 * preserved verbatim through load/refine/save round trips so an external
 * re-solver can tell which model version a returning file was refined against.
 */
export type RegistrationSource = Record<string, unknown>;

/**
 * One observation row in the portable registration JSON file (format
 * version 2). `imageLeft`/`imageRight` are the identity (`frame` is advisory
 * for producers and re-resolved by DIVE on load); `points` are flattened
 * [leftX, leftY, rightX, rightY] rows.
 */
export interface RegistrationFileObservation {
  frame?: number | null;
  imageLeft: string;
  imageRight: string;
  enabled?: boolean;
  source?: string;
  points?: number[][];
  stats?: ObservationStats;
}

/**
 * One camera pair in the portable registration JSON file. This is the same
 * self-describing shape the desktop platform persists as the project's
 * standalone per-camera <camera>_to_<reference>_registration.json files
 * (see desktop backend/native/common.ts), so a panel-saved file, the
 * on-disk artifacts, and an import-time seed are all interchangeable.
 * Points live ONLY inside `observations` (format v2) -- there is no
 * flattened duplicate.
 */
export interface RegistrationFilePair {
  left: string;
  right: string;
  observations?: RegistrationFileObservation[];
  leftToRight?: Matrix3 | null;
  rightToLeft?: Matrix3 | null;
  transformType?: TransformType;
}

/** Portable calibration file: everything needed to restore all pairs. */
export interface RegistrationFile {
  /** Written by panel saves for self-identification; optional on load. */
  type?: string;
  version: number;
  /** Producer provenance, preserved verbatim across round trips. */
  source?: RegistrationSource | null;
  pairs: RegistrationFilePair[];
}

/** Identifying `type` value of the registration JSON format. */
export const REGISTRATION_FILE_TYPE = 'dive-camera-registration';

/**
 * The registration file format version this client reads and writes. There
 * is exactly one shape: anything else is rejected with a clear message
 * rather than accepted, because a pre-observations (v1) file would otherwise
 * load as a matrix-only pair with its points silently dropped -- a
 * legitimate-looking state indistinguishable from a real producer file.
 */
export const REGISTRATION_FILE_VERSION = 2;

/** Chosen fit model per pair, keyed by {@link CameraRegistrationStore.pairKey}. Missing entries default to 'similarity'. */
export type CameraTransformTypes = Record<string, TransformType>;

/** Which image is warped onto which for the in-app aligned-picking preview. */
export type AlignmentMode = 'original' | 'AtoB' | 'BtoA';

export interface AlignmentState {
  mode: AlignmentMode;
  opacity: number;
}

/** Active pair. `camA` is the left camera, `camB` the right (user-chosen order). */
export interface ActivePair {
  camA: string;
  camB: string;
}

/**
 * Host-provided bridge between frame indices and image identities, published
 * by the viewer (which owns the per-camera media lists). Image-sequence
 * cameras resolve to real file names; video cameras resolve to stable
 * `frame://N` pseudo-names so the schema stays uniform across media types.
 */
export interface FrameResolver {
  /** The image name `camera` displays on its current frame. */
  currentImageName(camera: string): string | null;
  /** The dataset-local frame index showing `imageName` on `camera`, or null. */
  frameForImage(camera: string, imageName: string): number | null;
}

/** One row of the registration-frames list for a pair (see {@link CameraRegistrationStore.framesForPair}). */
export interface FrameSummary {
  frame: number | null;
  imageA: string;
  imageB: string;
  enabled: boolean;
  source: string;
  count: number;
  stats?: ObservationStats;
}

/** Per-observation agreement with the pooled fit (see {@link CameraRegistrationStore.pairFitStats}). */
export interface PairFitStats {
  /** RMS over every enabled observation's points against the pooled fit, or null without a fit. */
  rmsPx: number | null;
  pointCount: number;
  frameCount: number;
  perObservation: {
    frame: number | null;
    imageA: string;
    imageB: string;
    enabled: boolean;
    rmsPx: number | null;
  }[];
}

/** Fallback pseudo-image name for frame `frame` when no resolver is set. */
function pseudoImageName(frame: number): string {
  return `frame://${frame}`;
}

/**
 * Shared, reactive store for camera-registration data (per-image-pair
 * correspondence observations, fitted/loaded homographies, transform-type
 * choices, and producer provenance). Lives in vue-media-annotator so both
 * the annotation layers (client/src/alignedView) and the dive-common side
 * can consume it via the provide/inject system. Handles persistence:
 * hydrating saved state and loading/saving the portable registration JSON
 * format (version 2, observations only).
 *
 * A correspondence belongs to a (camera pair, image pair), not just a camera
 * pair: the image names are the persisted identity and frame indices are
 * resolved from them at load time. The pair-level homography pools points
 * from every enabled observation instead of trusting one frame.
 *
 * Also holds the interactive creation state, implementing the keypointgui
 * blue->red pairing flow: the first click in one camera sets a pending
 * point; the next click in the *other* camera completes a pair.
 */
export default class CameraRegistrationStore {
  activePair: Ref<ActivePair | null>;

  pickingEnabled: Ref<boolean>;

  pendingPoint: Ref<{ camera: string; coord: Point } | null>;

  observations: Ref<CameraObservations>;

  homographies: Ref<CameraHomographies>;

  transformTypes: Ref<CameraTransformTypes>;

  alignment: Ref<AlignmentState>;

  /**
   * The current (aggregate) frame, kept in sync by the viewer so newly
   * picked points can be stamped with the image pair they were picked on.
   */
  currentFrame: Ref<number>;

  /**
   * Whether pan/zoom is linked between the active pair's two cameras through
   * the pair's transform (see {@link useRegistrationNavigation}). Only has an
   * effect once a transform exists (fitted or file-loaded); toggled from the
   * panel's "Link pan/zoom".
   */
  linkedNav: Ref<boolean>;

  /**
   * Correspondence currently selected in the picking UI (grabbed marker /
   * clicked table row), highlighted in BOTH cameras' panes and deletable via
   * the panel or the Delete key. Authoring state only -- never persisted.
   */
  selectedCorrespondenceId: Ref<number | null>;

  /** Native-pixel coordinate under the cursor, for the registration panel's live readout. */
  cursorCoord: Ref<{ camera: string; coord: Point } | null>;

  /**
   * A one-shot "recenter here" request (e.g. from a right-click), keyed by an
   * incrementing id so repeated requests at the same coordinate still trigger
   * watchers. See {@link requestRecenter}.
   */
  recenterRequest: Ref<{ camera: string; coord: Point; id: number } | null>;

  /**
   * Message from the most recent failed fit attempt (e.g. collinear/degenerate
   * points that satisfy the minimum count but can't be solved), or null if the
   * active pair's last fit attempt (if any) succeeded. Surfaced by the
   * registration panel instead of letting the estimator's exception escape a
   * geojs click handler.
   */
  fitError: Ref<string | null>;

  /**
   * Provenance of the loaded calibration (see {@link RegistrationSource}).
   * Deliberately NOT cleared by in-app edits or refits -- refinements are
   * exactly what should travel back to the producer stamped with the model
   * lineage they were made against. Replaced (or cleared) only when a
   * calibration file is loaded or the store is re-hydrated.
   */
  source: Ref<RegistrationSource | null>;

  /** True when the calibration has unsaved changes since the last save or load. */
  dirty: ComputedRef<boolean>;

  private nextId: number;

  private nextRecenterId: number;

  /** Provenance per homography key; missing entries behave like 'fit'. */
  private homographySources: Record<string, HomographySource>;

  /** Serialized calibration at the last save/load, the baseline for {@link dirty}. */
  private savedSnapshot: Ref<string>;

  /** Host-provided frame/image bridge; null until the viewer publishes one. */
  private frameResolver: FrameResolver | null;

  constructor() {
    this.activePair = ref(null);
    this.pickingEnabled = ref(false);
    this.pendingPoint = ref(null);
    this.observations = ref({});
    this.homographies = ref({});
    this.transformTypes = ref({});
    this.alignment = ref({ mode: 'original', opacity: 0.5 });
    this.currentFrame = ref(0);
    this.linkedNav = ref(true);
    this.selectedCorrespondenceId = ref(null);
    this.cursorCoord = ref(null);
    this.recenterRequest = ref(null);
    this.fitError = ref(null);
    this.source = ref(null);
    this.nextId = 1;
    this.nextRecenterId = 1;
    this.homographySources = {};
    this.frameResolver = null;
    this.savedSnapshot = ref(this.registrationSnapshot());
    this.dirty = computed(() => this.registrationSnapshot() !== this.savedSnapshot.value);
  }

  /** Serialize the saved-to-dataset calibration state (observations, transforms, provenance). */
  private registrationSnapshot(): string {
    return JSON.stringify({
      homographies: this.homographies.value,
      observations: this.observations.value,
      transformTypes: this.transformTypes.value,
      source: this.source.value,
    });
  }

  /** Capture the current calibration as the saved baseline, so {@link dirty} reads false. */
  markSaved() {
    this.savedSnapshot.value = this.registrationSnapshot();
  }

  /**
   * The saved-baseline calibration (what the persisted registration -- the
   * per-camera registration files on desktop, the dataset meta on web --
   * currently holds). Parsed fresh from the snapshot on each call. Matches
   * cameraRegistrationFiles.ts's CameraRegistrationValues shape (the type
   * lives there and importing it here would be circular).
   */
  savedRegistrationValues(): {
    homographies: CameraHomographies;
    observations: CameraObservations;
    transformTypes: CameraTransformTypes;
    source: RegistrationSource | null;
    } {
    return JSON.parse(this.savedSnapshot.value);
  }

  /**
   * True when the saved baseline (last hydrate/save/load) already holds
   * registration data -- i.e. saving now would overwrite a persisted
   * registration rather than create a fresh one. Empty observation lists
   * don't count: clearing a pair leaves `[]` behind.
   */
  hasSavedRegistration(): boolean {
    const saved = this.savedRegistrationValues();
    return Object.keys(saved.homographies).length > 0
      || Object.values(saved.observations).some((list) => list.length > 0);
  }

  /**
   * True when the loaded calibration was assembled from per-camera files
   * whose producer stamps disagree (the loader records that as a
   * `{ mixed: true, files: {...} }` composite source) -- i.e. the rig may
   * mix calibration generations and deserves a visible warning rather than
   * silent composition.
   */
  sourceIsMixed(): boolean {
    return Boolean(this.source.value
      && (this.source.value as Record<string, unknown>).mixed === true);
  }

  /**
   * Directional key for a camera pair: `left::right`. Order is significant and
   * preserved so left/right (e.g. RGB vs IR) survives for ordered exports.
   */
  // eslint-disable-next-line class-methods-use-this
  pairKey(camA: string, camB: string): string {
    return `${camA}::${camB}`;
  }

  /** Key of the currently active pair, or null if none selected. */
  activePairKey(): string | null {
    const pair = this.activePair.value;
    return pair ? this.pairKey(pair.camA, pair.camB) : null;
  }

  /** Select a camera pair. `left` becomes camA, `right` becomes camB. */
  setActivePair(left: string | null, right: string | null) {
    if (!left || !right || left === right) {
      this.activePair.value = null;
    } else {
      this.activePair.value = { camA: left, camB: right };
    }
    this.pendingPoint.value = null;
    // Switching pairs invalidates any active overlay warp: drop back to the
    // unwarped Picking mode so the new pair starts from its own native views.
    this.alignment.value = { mode: 'original', opacity: this.alignment.value.opacity };
    this.selectedCorrespondenceId.value = null;
    this.cursorCoord.value = null;
    this.recenterRequest.value = null;
    this.fitError.value = null;
  }

  /**
   * Publish (or clear) the host's frame/image resolver and re-resolve every
   * observation's frame index against it. Called by the viewer once media
   * is loaded (and again if the media set changes): resolution at load time
   * is what makes a registration portable across deployments of the same
   * rig -- a re-index or re-import can't silently shift points onto the
   * wrong scene.
   */
  setFrameResolver(resolver: FrameResolver | null) {
    this.frameResolver = resolver;
    if (!resolver) {
      return;
    }
    const next: CameraObservations = {};
    let changed = false;
    Object.entries(this.observations.value).forEach(([key, list]) => {
      const [camA] = key.split('::');
      next[key] = list.map((obs) => {
        const frame = resolver.frameForImage(camA, obs.imageA);
        if (frame !== obs.frame) {
          changed = true;
          return { ...obs, frame };
        }
        return obs;
      });
    });
    if (changed) {
      this.observations.value = next;
      // Frame resolution is derived state: it must not mark the saved
      // calibration dirty on its own.
      this.savedSnapshot.value = this.registrationSnapshot();
    }
  }

  /** All observations for a pair key (empty list when none). */
  observationsForPair(key: string): CorrespondenceObservation[] {
    return this.observations.value[key] || [];
  }

  /** Pooled points from every ENABLED observation of `key` -- the fit input. */
  enabledPoints(key: string): CorrespondencePoint[] {
    return this.observationsForPair(key)
      .filter((obs) => obs.enabled)
      .flatMap((obs) => obs.points);
  }

  /** Total point count across every enabled observation of `key`. */
  enabledPointCount(key: string): number {
    return this.enabledPoints(key).length;
  }

  /** Flat per-point view of one frame's observations (the panel's table). */
  correspondencesForFrame(key: string, frame: number | null): Correspondence[] {
    return this.observationsForPair(key)
      .filter((obs) => obs.frame === frame)
      .flatMap((obs) => obs.points.map((point) => ({
        ...point,
        imageA: obs.imageA,
        imageB: obs.imageB,
        frame: obs.frame,
        source: obs.source,
      })));
  }

  /**
   * Flat per-point view of the observations visible in `camera`'s pane at
   * its local `frame` -- the keypoint layer's data source. The A side
   * matches on the observation's resolved frame; the B side re-resolves
   * imageB in camB's own frame space, so panes showing differently-indexed
   * media (aligned timelines) still draw each point on the scene it was
   * actually picked on.
   */
  correspondencesForCameraFrame(key: string, camera: string, frame: number): Correspondence[] {
    const [camA, camB] = key.split('::');
    return this.observationsForPair(key)
      .filter((obs) => {
        if (camera === camA) {
          return obs.frame === frame;
        }
        if (camera === camB) {
          const frameB = this.frameResolver
            ? this.frameResolver.frameForImage(camB, obs.imageB)
            : obs.frame;
          return frameB === frame;
        }
        return false;
      })
      .flatMap((obs) => obs.points.map((point) => ({
        ...point,
        imageA: obs.imageA,
        imageB: obs.imageB,
        frame: obs.frame,
        source: obs.source,
      })));
  }

  /**
   * The registration-frames list for a pair: one row per observation,
   * resolved rows sorted by frame, unresolved (frame null) rows last. This
   * is both the multi-pair selector and the quality readout.
   */
  framesForPair(key: string): FrameSummary[] {
    const rows = this.observationsForPair(key).map((obs) => ({
      frame: obs.frame,
      imageA: obs.imageA,
      imageB: obs.imageB,
      enabled: obs.enabled,
      source: obs.source,
      count: obs.points.length,
      stats: obs.stats,
    }));
    return rows.sort((a, b) => {
      if (a.frame === null && b.frame === null) {
        return a.imageA.localeCompare(b.imageA);
      }
      if (a.frame === null) {
        return 1;
      }
      if (b.frame === null) {
        return -1;
      }
      return a.frame - b.frame;
    });
  }

  /**
   * Per-observation reprojection RMS against the pair's CURRENT pooled
   * homography -- the diagnostic that makes a frame disagreeing with the
   * consensus visible and removable rather than quietly dragging the
   * solution. Disabled observations are still measured (against the fit
   * they're excluded from) so re-enabling them is an informed choice.
   */
  pairFitStats(key: string): PairFitStats {
    const homography = this.homographies.value[key];
    const observations = this.observationsForPair(key);
    const rmsOf = (points: CorrespondencePoint[]): number | null => {
      if (!homography || points.length === 0) {
        return null;
      }
      const sumSq = points.reduce((acc, point) => {
        const projected = applyHomography(homography.AtoB, point.a);
        return acc + (projected[0] - point.b[0]) ** 2 + (projected[1] - point.b[1]) ** 2;
      }, 0);
      return Math.sqrt(sumSq / points.length);
    };
    const enabled = observations.filter((obs) => obs.enabled);
    return {
      rmsPx: rmsOf(enabled.flatMap((obs) => obs.points)),
      pointCount: enabled.reduce((acc, obs) => acc + obs.points.length, 0),
      frameCount: enabled.filter((obs) => obs.points.length > 0).length,
      perObservation: observations.map((obs) => ({
        frame: obs.frame,
        imageA: obs.imageA,
        imageB: obs.imageB,
        enabled: obs.enabled,
        rmsPx: rmsOf(obs.points),
      })),
    };
  }

  /** Replace one pair's observation list (immutably) and leave others alone. */
  private setObservationsForPair(key: string, list: CorrespondenceObservation[]) {
    this.observations.value = { ...this.observations.value, [key]: list };
  }

  /**
   * Include or exclude one observation (identified by its image pair) from
   * the pooled fit, then refit. Excluding never deletes points.
   */
  setObservationEnabled(key: string, imageA: string, imageB: string, enabled: boolean) {
    const list = this.observationsForPair(key);
    if (!list.some((obs) => obs.imageA === imageA && obs.imageB === imageB)) {
      return;
    }
    this.setObservationsForPair(key, list.map((obs) => (
      (obs.imageA === imageA && obs.imageB === imageB) ? { ...obs, enabled } : obs)));
    this.maybeFitPair(key);
  }

  /** Include or exclude every observation at `frame` from the pooled fit, then refit. */
  setFrameEnabled(key: string, frame: number | null, enabled: boolean) {
    const list = this.observationsForPair(key);
    if (!list.some((obs) => obs.frame === frame)) {
      return;
    }
    this.setObservationsForPair(key, list.map((obs) => (
      obs.frame === frame ? { ...obs, enabled } : obs)));
    this.maybeFitPair(key);
  }

  /** Remove every observation at `frame` (points and all), then refit. */
  clearFrame(key: string, frame: number | null) {
    const list = this.observationsForPair(key);
    if (!list.some((obs) => obs.frame === frame)) {
      return;
    }
    const removedIds = new Set(list
      .filter((obs) => obs.frame === frame)
      .flatMap((obs) => obs.points.map((point) => point.id)));
    if (this.selectedCorrespondenceId.value !== null
      && removedIds.has(this.selectedCorrespondenceId.value)) {
      this.selectedCorrespondenceId.value = null;
    }
    this.setObservationsForPair(key, list.filter((obs) => obs.frame !== frame));
    this.maybeFitPair(key);
  }

  /** The image pair the active pair's cameras currently display. */
  private currentImagePair(pair: ActivePair): { imageA: string; imageB: string } {
    const fallback = pseudoImageName(this.currentFrame.value);
    return {
      imageA: this.frameResolver?.currentImageName(pair.camA) ?? fallback,
      imageB: this.frameResolver?.currentImageName(pair.camB) ?? fallback,
    };
  }

  /** Resolve the camA-space frame index for an image name (fallback: current frame). */
  private resolveFrame(camA: string, imageA: string): number | null {
    if (this.frameResolver) {
      return this.frameResolver.frameForImage(camA, imageA);
    }
    const match = /^frame:\/\/(\d+)$/.exec(imageA);
    return match ? Number(match[1]) : null;
  }

  /**
   * Add a clicked image point for `camera`. The first click sets a pending point;
   * a subsequent click in the *other* camera of the active pair completes a pair.
   * Clicking the same camera again replaces the pending point. Completed pairs
   * land in the current frame's MANUAL observation (created on first use),
   * stamped with the image pair being displayed.
   */
  addPoint(camera: string, coord: Point) {
    const pair = this.activePair.value;
    if (!pair || (camera !== pair.camA && camera !== pair.camB)) {
      return;
    }
    const pending = this.pendingPoint.value;
    if (!pending || pending.camera === camera) {
      this.pendingPoint.value = { camera, coord };
      return;
    }
    const key = this.pairKey(pair.camA, pair.camB);
    const a = pending.camera === pair.camA ? pending.coord : coord;
    const b = pending.camera === pair.camB ? pending.coord : coord;
    const { imageA, imageB } = this.currentImagePair(pair);
    const list = [...this.observationsForPair(key)];
    // eslint-disable-next-line no-plusplus
    const point = { id: this.nextId++, a, b };
    const index = list.findIndex((obs) => obs.imageA === imageA && obs.imageB === imageB
      && obs.source === MANUAL_SOURCE);
    if (index >= 0) {
      list[index] = { ...list[index], points: [...list[index].points, point] };
    } else {
      list.push({
        imageA,
        imageB,
        frame: this.resolveFrame(pair.camA, imageA) ?? this.currentFrame.value,
        enabled: true,
        source: MANUAL_SOURCE,
        points: [point],
      });
    }
    this.setObservationsForPair(key, list);
    this.pendingPoint.value = null;
    this.syncAlignmentHomography();
  }

  /**
   * Record a click at `coord` (native pixel coords of `camera`'s own pane).
   * New points are only picked in the unwarped 'original' (Picking) mode: while
   * an overlay warp is active the panes show a warped preview rather than native
   * coordinates, so clicks there are ignored.
   */
  pickPoint(camera: string, coord: Point) {
    if (this.alignment.value.mode !== 'original') {
      return;
    }
    this.addPoint(camera, coord);
  }

  /**
   * Move one side of an existing correspondence (drag-to-refine). `camera`
   * selects which side (a for camA, b for camB); the pair is refit live so
   * the alignment ghost and linked navigation track the drag.
   */
  updateCorrespondencePoint(id: number, camera: string, coord: Point) {
    const pair = this.activePair.value;
    if (!pair || (camera !== pair.camA && camera !== pair.camB)) {
      return;
    }
    const key = this.pairKey(pair.camA, pair.camB);
    const list = this.observationsForPair(key);
    if (!list.some((obs) => obs.points.some((point) => point.id === id))) {
      return;
    }
    const side = camera === pair.camA ? 'a' : 'b';
    this.setObservationsForPair(key, list.map((obs) => (
      obs.points.some((point) => point.id === id)
        ? {
          ...obs,
          points: obs.points.map((point) => (
            point.id === id ? { ...point, [side]: coord } : point)),
        }
        : obs)));
    this.syncAlignmentHomography();
  }

  /** Move the pending (blue) point while it is being drag-refined. */
  movePendingPoint(camera: string, coord: Point) {
    const pending = this.pendingPoint.value;
    if (!pending || pending.camera !== camera) {
      return;
    }
    this.pendingPoint.value = { camera, coord };
  }

  /**
   * Drop an observation that has lost its last point and carries no
   * producer statistics worth reviewing; keep stat-bearing ones (their
   * skip/quality readout is review content even without points).
   */
  private static pruneEmpty(list: CorrespondenceObservation[]): CorrespondenceObservation[] {
    return list.filter((obs) => obs.points.length > 0 || obs.stats !== undefined);
  }

  /** Remove a correspondence (by id) from the active pair -- both cameras' points at once. */
  removeCorrespondence(id: number) {
    const key = this.activePairKey();
    if (!key) {
      return;
    }
    const list = this.observationsForPair(key);
    if (!list.some((obs) => obs.points.some((point) => point.id === id))) {
      return;
    }
    this.setObservationsForPair(key, CameraRegistrationStore.pruneEmpty(
      list.map((obs) => ({
        ...obs,
        points: obs.points.filter((point) => point.id !== id),
      })),
    ));
    if (this.selectedCorrespondenceId.value === id) {
      this.selectedCorrespondenceId.value = null;
    }
    this.syncAlignmentHomography();
  }

  /**
   * Select a correspondence marker for inspection/deletion (null clears).
   * Only ids belonging to the active pair are selectable; anything else
   * clears the selection.
   */
  selectCorrespondence(id: number | null) {
    if (id === null) {
      this.selectedCorrespondenceId.value = null;
      return;
    }
    const key = this.activePairKey();
    const owned = key
      ? this.observationsForPair(key).some((obs) => obs.points.some((point) => point.id === id))
      : false;
    this.selectedCorrespondenceId.value = owned ? id : null;
  }

  /** Remove the selected correspondence (both cameras' points). No-op without a selection. */
  removeSelectedCorrespondence() {
    const id = this.selectedCorrespondenceId.value;
    if (id !== null) {
      this.removeCorrespondence(id);
    }
  }

  /**
   * Drop all observations, the pending point, and any homography
   * (fitted or file-loaded) for the active pair.
   */
  clearPair() {
    const key = this.activePairKey();
    this.pendingPoint.value = null;
    this.selectedCorrespondenceId.value = null;
    if (!key) {
      return;
    }
    this.setObservationsForPair(key, []);
    // Clearing is explicit: a file-loaded homography goes too. Dropping the
    // 'loaded' mark lets maybeFitPair remove it through the normal path.
    delete this.homographySources[key];
    this.maybeFitPair(key);
  }

  /**
   * Undo one step, mirroring keypointgui's Clear Last button: if there's a
   * pending (blue) point, drop it; otherwise remove the most recently
   * completed correspondence on the CURRENT frame (editing acts on the
   * frame being viewed; other frames' points are untouched).
   */
  clearLast() {
    if (this.pendingPoint.value) {
      this.pendingPoint.value = null;
      return;
    }
    const key = this.activePairKey();
    if (!key) {
      return;
    }
    const frame = this.currentFrame.value;
    const list = this.observationsForPair(key);
    // The most recently added point on this frame is the one with the
    // highest id (ids allocate monotonically).
    let target: { obsIndex: number; pointId: number } | null = null;
    list.forEach((obs, obsIndex) => {
      if (obs.frame !== frame) {
        return;
      }
      obs.points.forEach((point) => {
        if (!target || point.id > target.pointId) {
          target = { obsIndex, pointId: point.id };
        }
      });
    });
    if (!target) {
      return;
    }
    const { obsIndex, pointId } = target;
    if (this.selectedCorrespondenceId.value === pointId) {
      this.selectedCorrespondenceId.value = null;
    }
    this.setObservationsForPair(key, CameraRegistrationStore.pruneEmpty(
      list.map((obs, i) => (i === obsIndex
        ? { ...obs, points: obs.points.filter((point) => point.id !== pointId) }
        : obs)),
    ));
    this.syncAlignmentHomography();
  }

  /**
   * True when `key`'s homography came from a calibration file rather than an
   * in-app fit. Not independently reactive -- always read alongside
   * {@link homographies} (provenance only changes when that map does).
   */
  isLoadedHomography(key: string): boolean {
    return this.homographySources[key] === 'loaded';
  }

  /**
   * Default picking posture when a pair becomes active: authoring (true)
   * unless the pair already has a file-loaded transform, in which case it
   * opens in a review posture (false) so stray clicks don't start placing
   * points on top of a registration that needs no points. The user can still
   * opt back in via the panel's "Edit points" toggle to refine.
   */
  pickingDefaultFor(key: string | null): boolean {
    return !(key && this.homographies.value[key] && this.isLoadedHomography(key));
  }

  /**
   * True when `key`'s transform was fitted from in-app picked points while a
   * producer-stamped calibration is loaded -- i.e. the pair has diverged from
   * what the stamped {@link source} shipped (producer files carry matrix-only
   * pairs, so any point-backed fit is a human refinement). Derived rather
   * than stored: it survives save/reload naturally, because point-backed
   * pairs re-mark as fitted on hydrate. Read alongside {@link homographies},
   * same reactivity caveat as {@link isLoadedHomography}.
   */
  isRefinedFromSource(key: string): boolean {
    return this.source.value !== null
      && this.homographies.value[key] !== undefined
      && this.homographySources[key] === 'fit';
  }

  /** The chosen fit model for `key`, defaulting to {@link DEFAULT_TRANSFORM_TYPE} when unset. */
  transformTypeForPair(key: string): TransformType {
    return this.transformTypes.value[key] || DEFAULT_TRANSFORM_TYPE;
  }

  /** Choose the fit model for `key` and immediately (re)fit or clear as needed. */
  setTransformType(key: string, type: TransformType) {
    this.transformTypes.value = { ...this.transformTypes.value, [key]: type };
    this.maybeFitPair(key);
  }

  /**
   * Fit `key` when its enabled observations pool enough points for its chosen
   * transform type; otherwise clear its homography and, if it's the active
   * (aligned) pair, revert alignment to 'original'. A fit can still fail past
   * the minimum-count check (e.g. collinear/near-duplicate points make the
   * system unsolvable); that's caught here and surfaced via {@link fitError}
   * instead of throwing out of a geojs click handler, keeping any previously
   * fitted homography in place.
   */
  maybeFitPair(key: string) {
    const required = minPointsForTransform(this.transformTypeForPair(key));
    if (this.enabledPointCount(key) < required) {
      // A file-loaded homography has no backing points; it stays in place
      // until enough points are picked to fit a replacement (or the pair is
      // explicitly cleared, which drops its 'loaded' mark first).
      if (this.homographySources[key] !== 'loaded') {
        const rest = { ...this.homographies.value };
        delete rest[key];
        this.homographies.value = rest;
        delete this.homographySources[key];
        if (this.activePairKey() === key && this.alignment.value.mode !== 'original') {
          this.alignment.value = { ...this.alignment.value, mode: 'original' };
        }
      }
      if (this.activePairKey() === key) {
        this.fitError.value = null;
      }
      return;
    }
    try {
      this.fitTransform(key);
      if (this.activePairKey() === key) {
        this.fitError.value = null;
      }
    } catch (err) {
      if (this.activePairKey() === key) {
        this.fitError.value = err instanceof Error ? err.message : String(err);
      }
    }
  }

  /** Fit the active pair when it has enough points; otherwise clear/revert as in {@link maybeFitPair}. */
  maybeFitActivePair() {
    const key = this.activePairKey();
    if (!key) {
      return;
    }
    this.maybeFitPair(key);
  }

  /** Enable or change the alignment (ghost overlay) mode, fitting the pair first if needed. */
  setAlignmentMode(mode: AlignmentMode) {
    if (mode !== 'original') {
      this.maybeFitActivePair();
      const key = this.activePairKey();
      if (!key || !this.homographies.value[key]) {
        // Not enough points for the active pair's transform type; stay original.
        return;
      }
    }
    this.alignment.value = { ...this.alignment.value, mode };
  }

  /** Ghost overlay opacity, independent of alignment mode. */
  setAlignmentOpacity(opacity: number) {
    this.alignment.value = { ...this.alignment.value, opacity };
  }

  /**
   * Map `coord` (native pixel space of `camera`) to the corresponding point in
   * the *other* camera of the active pair, via the fitted homography. Returns
   * `null` when `camera` isn't part of the active pair or the pair has no
   * fitted homography yet (not enough correspondences) -- callers should treat
   * that as "nothing to link to" rather than an error.
   */
  linkedPoint(camera: string, coord: Point): { camera: string; coord: Point } | null {
    const pair = this.activePair.value;
    if (!pair || (camera !== pair.camA && camera !== pair.camB)) {
      return null;
    }
    const homog = this.homographies.value[this.pairKey(pair.camA, pair.camB)];
    if (!homog) {
      return null;
    }
    const other = camera === pair.camA ? pair.camB : pair.camA;
    const matrix = camera === pair.camA ? homog.AtoB : homog.BtoA;
    return { camera: other, coord: applyHomography(matrix, coord) };
  }

  /** Record the native-pixel coordinate under the cursor for `camera` (registration panel readout). */
  setCursorCoord(camera: string, coord: Point) {
    this.cursorCoord.value = { camera, coord };
  }

  /** Clear the cursor coordinate readout (e.g. on mouse leave). */
  clearCursorCoord() {
    this.cursorCoord.value = null;
  }

  /**
   * Request that `camera` (native pixel coords `coord`) and, when the pair has
   * a fitted homography, the other camera of the active pair (via
   * {@link linkedPoint}) recenter their views on this location. Consumed by
   * {@link useRegistrationNavigation}; a no-op if `camera` isn't part of the
   * active pair. A one-shot "snap to this feature" action, distinct from the
   * continuous pan/zoom link that is active while picking.
   */
  requestRecenter(camera: string, coord: Point) {
    const pair = this.activePair.value;
    if (!pair || (camera !== pair.camA && camera !== pair.camB)) {
      return;
    }
    // eslint-disable-next-line no-plusplus
    this.recenterRequest.value = { camera, coord, id: this.nextRecenterId++ };
  }

  /** Re-fit the active pair while alignment is active (mode != 'original'). */
  private syncAlignmentHomography() {
    if (this.alignment.value.mode !== 'original') {
      this.maybeFitActivePair();
    }
  }

  /**
   * Fit `key`'s chosen transform type from the points POOLED across every
   * enabled observation (see {@link minPointsForTransform} for the required
   * count) -- the fit is the pair's consensus over every contributing frame,
   * not one frame's opinion. Computes both directions and stores them.
   * Returns the fitted pair.
   */
  fitTransform(key: string): PairHomography {
    const points = this.enabledPoints(key);
    const type = this.transformTypeForPair(key);
    const required = minPointsForTransform(type);
    if (points.length < required) {
      throw new Error(`At least ${required} point pair(s) are required to fit a ${type} transform`);
    }
    const AtoB = estimateTransform(type, points.map((c) => c.a), points.map((c) => c.b));
    const BtoA = invert3(AtoB);
    this.homographies.value = { ...this.homographies.value, [key]: { AtoB, BtoA } };
    this.homographySources[key] = 'fit';
    return { AtoB, BtoA };
  }

  /**
   * Merge automatically computed observations for `camA` -> `camB` into the
   * pair AT OBSERVATION GRANULARITY: an incoming observation replaces the
   * existing observation with the same (image pair, source) identity --
   * re-running the matcher updates its own prior results -- while manual
   * observations and other image pairs' results are kept. The points land in
   * the normal per-frame tables so the user can inspect, delete, or
   * drag-refine them exactly like hand-picked ones; each observation carries
   * its producer id, closing the provenance gap the flat format had.
   * Switches the pair to a homography fit and refits from the pooled points.
   * Picking is switched on so the injected points are immediately visible
   * for review -- the keypoint layer draws nothing while picking is off.
   *
   * Deliberately does NOT touch {@link source}: that stamp is rig-global
   * (written into EVERY per-camera registration file), so recording this one
   * pair's matcher provenance there would falsely restamp -- and therefore
   * rewrite -- the other cameras' files on the next save. Provenance rides
   * on each observation instead.
   */
  applyRegistrationResult(
    camA: string,
    camB: string,
    incoming: {
      /** Image-pair identity; defaults to the images currently displayed. */
      imageA?: string;
      imageB?: string;
      frame?: number | null;
      enabled?: boolean;
      source: string;
      stats?: ObservationStats;
      points: [number, number, number, number][];
    }[],
  ) {
    const key = this.pairKey(camA, camB);
    const current = this.currentImagePair({ camA, camB });
    const list = [...this.observationsForPair(key)];
    incoming.forEach((raw) => {
      const entry = {
        ...raw,
        imageA: raw.imageA ?? current.imageA,
        imageB: raw.imageB ?? current.imageB,
      };
      const observation: CorrespondenceObservation = {
        imageA: entry.imageA,
        imageB: entry.imageB,
        frame: this.resolveFrame(camA, entry.imageA) ?? entry.frame ?? null,
        enabled: entry.enabled ?? true,
        source: entry.source,
        ...(entry.stats !== undefined ? { stats: entry.stats } : {}),
        points: entry.points.map(([ax, ay, bx, by]) => ({
          // eslint-disable-next-line no-plusplus
          id: this.nextId++,
          a: [ax, ay] as Point,
          b: [bx, by] as Point,
        })),
      };
      const index = list.findIndex((obs) => obs.imageA === entry.imageA
        && obs.imageB === entry.imageB && obs.source === entry.source);
      if (index >= 0) {
        list[index] = observation;
      } else {
        list.push(observation);
      }
    });
    this.setObservationsForPair(key, list);
    this.pendingPoint.value = null;
    this.selectedCorrespondenceId.value = null;
    this.transformTypes.value = { ...this.transformTypes.value, [key]: 'homography' };
    this.pickingEnabled.value = true;
    this.maybeFitPair(key);
  }

  /**
   * Parse and load a registration JSON file (format version 2 ONLY: the
   * per-camera <camera>_to_<reference>_registration.json format written by
   * cameraRegistrationFiles.ts's buildPerCameraRegistrationFiles),
   * REPLACING all pairs' observations, homographies, and transform types.
   * The active pair selection and picking toggle are left alone; the
   * alignment ghost reverts to 'original' since the transform under it
   * changed wholesale. Throws a descriptive Error on malformed input --
   * including any version other than {@link REGISTRATION_FILE_VERSION} --
   * without touching current state. Returns the camera names referenced by
   * the file so callers can warn about ones missing from the loaded dataset.
   */
  loadRegistrationText(text: string): { cameras: string[]; pairCount: number } {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('File is not valid JSON');
    }
    const file = data as Partial<RegistrationFile>;
    if (!Array.isArray(file?.pairs)) {
      throw new Error('Not a DIVE camera registration file (expected a "pairs" list)');
    }
    if (file.version !== REGISTRATION_FILE_VERSION) {
      throw new Error(
        `Unsupported registration file version ${JSON.stringify(file.version)} `
        + `(expected ${REGISTRATION_FILE_VERSION}). Regenerate the file with a `
        + 'current producer; pre-v2 files have no per-image-pair observations.',
      );
    }
    const source = CameraRegistrationStore.readSource(file.source);
    const observations: CameraObservations = {};
    const homographies: CameraHomographies = {};
    const transformTypes: CameraTransformTypes = {};
    const cameras = new Set<string>();
    file.pairs.forEach((pair, i) => {
      const context = `Pair ${i + 1}`;
      if (typeof pair?.left !== 'string' || typeof pair?.right !== 'string'
        || !pair.left || !pair.right || pair.left === pair.right) {
        throw new Error(`${context}: "left" and "right" must be two distinct camera names`);
      }
      const key = this.pairKey(pair.left, pair.right);
      cameras.add(pair.left);
      cameras.add(pair.right);
      if (pair.transformType !== undefined) {
        if (!TRANSFORM_TYPES.some((t) => t.value === pair.transformType)) {
          throw new Error(
            `${context}: unknown transformType "${pair.transformType}" (expected one of ${TRANSFORM_TYPES.map((t) => t.value).join(', ')})`,
          );
        }
        transformTypes[key] = pair.transformType;
      }
      observations[key] = (pair.observations || []).map((raw, j) => this.readObservation(
        raw, pair.left, `${context}, observation ${j + 1}`,
      ));
      const leftToRight = (pair.leftToRight === null || pair.leftToRight === undefined)
        ? null
        : CameraRegistrationStore.readMatrix(pair.leftToRight, `${context}, leftToRight`);
      const rightToLeft = (pair.rightToLeft === null || pair.rightToLeft === undefined)
        ? null
        : CameraRegistrationStore.readMatrix(pair.rightToLeft, `${context}, rightToLeft`);
      if (leftToRight || rightToLeft) {
        // If only one direction is present, derive the other by inversion
        // (readMatrix guarantees invertibility).
        homographies[key] = {
          AtoB: leftToRight ?? invert3(rightToLeft as Matrix3),
          BtoA: rightToLeft ?? invert3(leftToRight as Matrix3),
        };
      }
    });
    this.observations.value = observations;
    this.homographies.value = homographies;
    this.transformTypes.value = transformTypes;
    this.source.value = source;
    this.markHomographySources();
    this.renumberPoints();
    this.pendingPoint.value = null;
    this.selectedCorrespondenceId.value = null;
    this.fitError.value = null;
    this.alignment.value = { ...this.alignment.value, mode: 'original' };
    return { cameras: [...cameras], pairCount: file.pairs.length };
  }

  /** Validate an untrusted file observation and resolve its frame. */
  private readObservation(
    raw: unknown,
    camA: string,
    context: string,
  ): CorrespondenceObservation {
    const obs = raw as Partial<RegistrationFileObservation>;
    if (typeof obs?.imageLeft !== 'string' || !obs.imageLeft
      || typeof obs?.imageRight !== 'string' || !obs.imageRight) {
      throw new Error(`${context}: "imageLeft" and "imageRight" image names are required`);
    }
    if (obs.enabled !== undefined && typeof obs.enabled !== 'boolean') {
      throw new Error(`${context}: "enabled" must be a boolean when present`);
    }
    if (obs.source !== undefined && (typeof obs.source !== 'string' || !obs.source)) {
      throw new Error(`${context}: "source" must be a non-empty string when present`);
    }
    if (obs.frame !== undefined && obs.frame !== null && !Number.isInteger(obs.frame)) {
      throw new Error(`${context}: "frame" must be an integer when present`);
    }
    if (obs.stats !== undefined
      && (typeof obs.stats !== 'object' || obs.stats === null || Array.isArray(obs.stats))) {
      throw new Error(`${context}: "stats" must be an object when present`);
    }
    const points = (obs.points || []).map((row, j) => {
      const [ax, ay, bx, by] = CameraRegistrationStore.readPointsRow(
        row, `${context}, points row ${j + 1}`,
      );
      // Ids are renumbered after the whole file parses (renumberPoints).
      return {
        id: 0, a: [ax, ay] as Point, b: [bx, by] as Point,
      };
    });
    // The image names are the identity: resolve the frame here (the file's
    // own frame value is advisory -- a producer may not know this dataset's
    // indices, and a stale one must not shift points onto the wrong scene).
    const resolved = this.resolveFrame(camA, obs.imageLeft);
    return {
      imageA: obs.imageLeft,
      imageB: obs.imageRight,
      frame: resolved ?? (this.frameResolver ? null : (obs.frame ?? null)),
      enabled: obs.enabled ?? true,
      source: obs.source || MANUAL_SOURCE,
      ...(obs.stats !== undefined ? { stats: obs.stats as ObservationStats } : {}),
      points,
    };
  }

  /** Assign fresh sequential ids to every point (after a bulk load). */
  private renumberPoints() {
    let id = 0;
    const next: CameraObservations = {};
    Object.entries(this.observations.value).forEach(([key, list]) => {
      next[key] = list.map((obs) => ({
        ...obs,
        points: obs.points.map((point) => {
          id += 1;
          return { ...point, id };
        }),
      }));
    });
    this.observations.value = next;
    this.nextId = id + 1;
  }

  /** Validate an untrusted `source` value: a plain object, or absent (-> null). */
  private static readSource(raw: unknown): RegistrationSource | null {
    if (raw === undefined || raw === null) {
      return null;
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('"source" must be an object when present');
    }
    return raw as RegistrationSource;
  }

  /** Validate an untrusted value as a 4-element finite [leftX, leftY, rightX, rightY] row. */
  private static readPointsRow(raw: unknown, context: string): [number, number, number, number] {
    if (!Array.isArray(raw) || raw.length !== 4) {
      throw new Error(`${context}: expected [leftX, leftY, rightX, rightY]`);
    }
    const nums = raw.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) {
      throw new Error(`${context}: expected [leftX, leftY, rightX, rightY] with finite numbers`);
    }
    return [nums[0], nums[1], nums[2], nums[3]];
  }

  /** Validate an untrusted value as an invertible row-major 3x3 matrix. */
  private static readMatrix(raw: unknown, context: string): Matrix3 {
    if (!Array.isArray(raw) || raw.length !== 3
      || raw.some((row) => !Array.isArray(row) || row.length !== 3)) {
      throw new Error(`${context}: expected a 3x3 matrix`);
    }
    const m = (raw as unknown[][]).map((row) => row.map(Number));
    if (m.some((row) => row.some((n) => !Number.isFinite(n)))) {
      throw new Error(`${context}: matrix entries must be finite numbers`);
    }
    try {
      invert3(m);
    } catch {
      throw new Error(`${context}: matrix is singular (not invertible)`);
    }
    return m;
  }

  /**
   * Reset homography provenance after bulk-loading state: a homography whose
   * pair pools too few enabled points for its transform type can only have
   * come from a file ('loaded', so refit checks preserve it); one with
   * enough points is treated as fitted from them.
   */
  private markHomographySources() {
    this.homographySources = {};
    Object.keys(this.homographies.value).forEach((key) => {
      const count = this.enabledPointCount(key);
      const required = minPointsForTransform(this.transformTypeForPair(key));
      this.homographySources[key] = count >= required ? 'fit' : 'loaded';
    });
  }

  /** Reset state and load saved homographies, observations, transform type choices, and provenance. */
  hydrate(
    homographies?: CameraHomographies,
    observations?: CameraObservations,
    transformTypes?: CameraTransformTypes,
    source?: RegistrationSource | null,
  ) {
    this.homographies.value = homographies ? { ...homographies } : {};
    this.observations.value = observations ? { ...observations } : {};
    this.transformTypes.value = transformTypes ? { ...transformTypes } : {};
    this.source.value = source ?? null;
    this.markHomographySources();
    this.activePair.value = null;
    this.pendingPoint.value = null;
    this.pickingEnabled.value = false;
    this.alignment.value = { mode: 'original', opacity: 0.5 };
    this.selectedCorrespondenceId.value = null;
    this.cursorCoord.value = null;
    this.recenterRequest.value = null;
    this.fitError.value = null;
    // Resume id allocation past any restored points.
    let maxId = 0;
    Object.values(this.observations.value).forEach((list) => {
      list.forEach((obs) => {
        obs.points.forEach((point) => { maxId = Math.max(maxId, point.id); });
      });
    });
    this.nextId = maxId + 1;
    // Re-resolve frames against the current resolver, if one is published.
    if (this.frameResolver) {
      this.setFrameResolver(this.frameResolver);
    }
    // The freshly loaded state is the saved baseline.
    this.markSaved();
  }
}
