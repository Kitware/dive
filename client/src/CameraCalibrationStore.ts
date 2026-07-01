import { ref, Ref } from 'vue';
import {
  invert3, applyHomography, Matrix3, Point,
} from './homography';
import { TransformType, minPointsForTransform, estimateTransform } from './transform';

/**
 * A single picked point pair. `a` is the point in the left camera (camA), `b`
 * the point in the right camera (camB). Left/right is the order the user chose,
 * which is preserved (not alphabetized) so it can drive ordered exports such as
 * the keypointgui-style points.txt consumed by VIAME/SealTk.
 */
export interface Correspondence {
  id: number;
  a: Point;
  b: Point;
}

/** Both directions of the fitted alignment transform for one camera pair. */
export interface PairHomography {
  /** Maps left (camA) image coordinates onto right (camB). */
  AtoB: Matrix3;
  /** Maps right (camB) image coordinates onto left (camA). */
  BtoA: Matrix3;
}

/** Fitted transforms keyed by {@link CameraCalibrationStore.pairKey}. */
export type CameraHomographies = Record<string, PairHomography>;

/** Picked correspondences keyed by {@link CameraCalibrationStore.pairKey}. */
export type CameraCorrespondences = Record<string, Correspondence[]>;

/** Chosen fit model per pair, keyed by {@link CameraCalibrationStore.pairKey}. Missing entries default to 'homography'. */
export type CameraTransformTypes = Record<string, TransformType>;

/** Which image is warped onto which for the in-app aligned-picking preview. */
export type AlignmentMode = 'original' | 'AtoB' | 'BtoA';

/** Whether a click in an aligned (ghosted) pane is attributed to that pane's own camera, or the ghosted source camera. */
export type PickTarget = 'native' | 'ghost';

export interface AlignmentState {
  mode: AlignmentMode;
  opacity: number;
  pickTarget: PickTarget;
}

/** Active pair. `camA` is the left camera, `camB` the right (user-chosen order). */
export interface ActivePair {
  camA: string;
  camB: string;
}

/**
 * Shared, reactive state for the interactive camera-calibration tool. Lives in
 * vue-media-annotator so both the geojs picking layer (client/src/layers) and the
 * dive-common side panel can consume it via the provide/inject system.
 *
 * Implements the keypointgui blue->red pairing flow: the first click in one camera
 * sets a pending point; the next click in the *other* camera completes a pair.
 */
export default class CameraCalibrationStore {
  activePair: Ref<ActivePair | null>;

  pickingEnabled: Ref<boolean>;

  pendingPoint: Ref<{ camera: string; coord: Point } | null>;

  correspondences: Ref<CameraCorrespondences>;

  homographies: Ref<CameraHomographies>;

  transformTypes: Ref<CameraTransformTypes>;

  alignment: Ref<AlignmentState>;

  /** Whether pan/zoom recentering is linked between the active pair's two cameras. */
  linkedNav: Ref<boolean>;

  /** Native-pixel coordinate under the cursor, for the calibration panel's live readout. */
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
   * calibration panel instead of letting the estimator's exception escape a
   * geojs click handler.
   */
  fitError: Ref<string | null>;

  private nextId: number;

  private nextRecenterId: number;

  constructor() {
    this.activePair = ref(null);
    this.pickingEnabled = ref(false);
    this.pendingPoint = ref(null);
    this.correspondences = ref({});
    this.homographies = ref({});
    this.transformTypes = ref({});
    this.alignment = ref({ mode: 'original', opacity: 0.5, pickTarget: 'native' });
    this.linkedNav = ref(false);
    this.cursorCoord = ref(null);
    this.recenterRequest = ref(null);
    this.fitError = ref(null);
    this.nextId = 1;
    this.nextRecenterId = 1;
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
    // Switching pairs invalidates any active alignment/ghost picking state: a
    // stale 'ghost' pick target could otherwise silently misattribute the next
    // click to the wrong camera once the new pair has its own homography fitted.
    this.alignment.value = { mode: 'original', opacity: this.alignment.value.opacity, pickTarget: 'native' };
    this.cursorCoord.value = null;
    this.recenterRequest.value = null;
    this.fitError.value = null;
  }

  /**
   * Add a clicked image point for `camera`. The first click sets a pending point;
   * a subsequent click in the *other* camera of the active pair completes a pair.
   * Clicking the same camera again replaces the pending point.
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
    const list = this.correspondences.value[key]
      ? [...this.correspondences.value[key]]
      : [];
    // eslint-disable-next-line no-plusplus
    list.push({ id: this.nextId++, a, b });
    this.correspondences.value = { ...this.correspondences.value, [key]: list };
    this.pendingPoint.value = null;
    this.syncAlignmentHomography();
  }

  /**
   * Record a click at `coord` (native pixel coords of `camera`'s own pane). When
   * alignment is active, the pick target is 'ghost', and `camera` is the pane
   * currently showing the ghost overlay (the alignment "destination" pane), the
   * coordinate is inverse-mapped through the fitted homography and attributed to
   * the *source* camera being ghosted instead of `camera` -- letting the user
   * complete a correspondence pair from a single pane. Clicking the source
   * (non-ghosted) pane, or clicking with the pick target set to 'native', always
   * records a native point for `camera` itself, same as {@link addPoint}.
   */
  pickPoint(camera: string, coord: Point) {
    const pair = this.activePair.value;
    const { mode, pickTarget } = this.alignment.value;
    if (pair && mode !== 'original' && pickTarget === 'ghost') {
      const srcCam = mode === 'BtoA' ? pair.camB : pair.camA;
      const dstCam = mode === 'BtoA' ? pair.camA : pair.camB;
      if (camera === dstCam) {
        const homog = this.homographies.value[this.pairKey(pair.camA, pair.camB)];
        if (homog) {
          this.addPoint(srcCam, applyHomography(invert3(homog[mode]), coord));
          return;
        }
      }
    }
    this.addPoint(camera, coord);
  }

  /** Remove a correspondence (by id) from the active pair. */
  removeCorrespondence(id: number) {
    const key = this.activePairKey();
    if (!key) {
      return;
    }
    const list = this.correspondences.value[key];
    if (!list) {
      return;
    }
    this.correspondences.value = {
      ...this.correspondences.value,
      [key]: list.filter((c) => c.id !== id),
    };
    this.syncAlignmentHomography();
  }

  /** Drop all correspondences and the pending point for the active pair. */
  clearPair() {
    const key = this.activePairKey();
    this.pendingPoint.value = null;
    if (!key) {
      return;
    }
    this.correspondences.value = { ...this.correspondences.value, [key]: [] };
    this.syncAlignmentHomography();
  }

  /**
   * Undo one step, mirroring keypointgui's Clear Last button: if there's a
   * pending (blue) point, drop it; otherwise remove the most recently
   * completed correspondence for the active pair.
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
    const list = this.correspondences.value[key];
    if (!list || list.length === 0) {
      return;
    }
    this.correspondences.value = { ...this.correspondences.value, [key]: list.slice(0, -1) };
    this.syncAlignmentHomography();
  }

  /** The chosen fit model for `key`, defaulting to 'homography' when unset. */
  transformTypeForPair(key: string): TransformType {
    return this.transformTypes.value[key] || 'homography';
  }

  /** Choose the fit model for `key` and immediately (re)fit or clear as needed. */
  setTransformType(key: string, type: TransformType) {
    this.transformTypes.value = { ...this.transformTypes.value, [key]: type };
    this.maybeFitPair(key);
  }

  /**
   * Fit `key` when it has enough points for its chosen transform type; otherwise
   * clear its homography and, if it's the active (aligned) pair, revert
   * alignment to 'original'. A fit can still fail past the minimum-count check
   * (e.g. collinear/near-duplicate points make the system unsolvable); that's
   * caught here and surfaced via {@link fitError} instead of throwing out of a
   * geojs click handler, keeping any previously fitted homography in place.
   */
  maybeFitPair(key: string) {
    const list = this.correspondences.value[key];
    const required = minPointsForTransform(this.transformTypeForPair(key));
    if (!list || list.length < required) {
      const rest = { ...this.homographies.value };
      delete rest[key];
      this.homographies.value = rest;
      if (this.activePairKey() === key && this.alignment.value.mode !== 'original') {
        this.alignment.value = { ...this.alignment.value, mode: 'original', pickTarget: 'native' };
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
    const pickTarget = mode === 'original' ? 'native' : this.alignment.value.pickTarget;
    this.alignment.value = { ...this.alignment.value, mode, pickTarget };
  }

  /** Ghost overlay opacity, independent of alignment mode. */
  setAlignmentOpacity(opacity: number) {
    this.alignment.value = { ...this.alignment.value, opacity };
  }

  /** Choose whether a click in an aligned pane is native or attributed to the ghosted camera. No-op while alignment is 'original'. */
  setPickTarget(pickTarget: PickTarget) {
    if (this.alignment.value.mode === 'original') {
      return;
    }
    this.alignment.value = { ...this.alignment.value, pickTarget };
  }

  /** Enable or disable linked pan/zoom recentering between the active pair's cameras. */
  setLinkedNav(enabled: boolean) {
    this.linkedNav.value = enabled;
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

  /** Record the native-pixel coordinate under the cursor for `camera` (calibration panel readout). */
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
   * {@link useCalibrationNavigation}; a no-op if `camera` isn't part of the
   * active pair. Works independent of {@link linkedNav} -- this is a one-shot
   * "snap to this feature" action, not the continuous pan/zoom link.
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
   * Fit `key`'s chosen transform type from its correspondences (see
   * {@link minPointsForTransform} for the required count). Computes both
   * directions and stores them. Returns the fitted pair.
   */
  fitTransform(key: string): PairHomography {
    const list = this.correspondences.value[key];
    const type = this.transformTypeForPair(key);
    const required = minPointsForTransform(type);
    if (!list || list.length < required) {
      throw new Error(`At least ${required} point pair(s) are required to fit a ${type} transform`);
    }
    const AtoB = estimateTransform(type, list.map((c) => c.a), list.map((c) => c.b));
    const BtoA = invert3(AtoB);
    this.homographies.value = { ...this.homographies.value, [key]: { AtoB, BtoA } };
    return { AtoB, BtoA };
  }

  /**
   * Serialize a pair's correspondences as keypointgui-style points text: one row
   * per pair, four space-separated columns `leftX leftY rightX rightY`. This is
   * the format consumed by VIAME's `itk_point_set_to_transform` to build the .h5.
   */
  toPointsText(key: string): string {
    const list = this.correspondences.value[key] || [];
    return list
      .map((c) => `${c.a[0]} ${c.a[1]} ${c.b[0]} ${c.b[1]}`)
      .join('\n');
  }

  /**
   * Parse keypointgui-style points text (rows of "leftX leftY rightX rightY",
   * the format written by {@link toPointsText} and by keypointgui's
   * `np.savetxt`) into correspondences for `key`. Blank lines are ignored.
   * Throws if any non-blank line doesn't parse to exactly 4 finite numbers.
   *
   * `mode: 'replace'` (default) discards `key`'s existing correspondences
   * first, matching keypointgui's own Load behavior; `'merge'` appends to
   * them instead.
   */
  loadPointsFromText(key: string, text: string, mode: 'replace' | 'merge' = 'replace') {
    const rows = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    const parsed = rows.map((line, i) => {
      const parts = line.split(/\s+/).map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error(`Line ${i + 1} of points file is not "leftX leftY rightX rightY": "${line}"`);
      }
      return parts as [number, number, number, number];
    });
    const existing = mode === 'merge' ? (this.correspondences.value[key] || []) : [];
    const added: Correspondence[] = parsed.map(([ax, ay, bx, by]) => ({
      // eslint-disable-next-line no-plusplus
      id: this.nextId++,
      a: [ax, ay] as Point,
      b: [bx, by] as Point,
    }));
    this.correspondences.value = { ...this.correspondences.value, [key]: [...existing, ...added] };
    this.syncAlignmentHomography();
  }

  /**
   * Serialize the fitted homography for `key` in `direction` as whitespace
   * -separated rows (matching keypointgui's `np.savetxt` output for
   * `on_save_left_to_right_homography` / `on_save_right_to_left_homography`).
   * Returns null if `key` has no fitted homography yet.
   */
  toHomographyText(key: string, direction: 'AtoB' | 'BtoA'): string | null {
    const homog = this.homographies.value[key];
    if (!homog) {
      return null;
    }
    return homog[direction].map((row) => row.join(' ')).join('\n');
  }

  /** Reset state and load saved homographies, correspondences, and transform type choices. */
  hydrate(
    homographies?: CameraHomographies,
    correspondences?: CameraCorrespondences,
    transformTypes?: CameraTransformTypes,
  ) {
    this.homographies.value = homographies ? { ...homographies } : {};
    this.correspondences.value = correspondences ? { ...correspondences } : {};
    this.transformTypes.value = transformTypes ? { ...transformTypes } : {};
    this.activePair.value = null;
    this.pendingPoint.value = null;
    this.pickingEnabled.value = false;
    this.alignment.value = { mode: 'original', opacity: 0.5, pickTarget: 'native' };
    this.linkedNav.value = false;
    this.cursorCoord.value = null;
    this.recenterRequest.value = null;
    this.fitError.value = null;
    // Resume id allocation past any restored correspondences.
    let maxId = 0;
    Object.values(this.correspondences.value).forEach((list) => {
      list.forEach((c) => { maxId = Math.max(maxId, c.id); });
    });
    this.nextId = maxId + 1;
  }
}
