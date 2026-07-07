import { ref, Ref } from 'vue';
import {
  invert3, applyHomography, Matrix3, Point,
} from './homography';
import {
  TransformType, TRANSFORM_TYPES, minPointsForTransform, estimateTransform,
} from './transform';

/**
 * A single picked point pair. `a` is the point in the left camera (camA), `b`
 * the point in the right camera (camB). Left/right is the order the user chose,
 * which is preserved (not alphabetized) so it survives round trips through the
 * calibration JSON's ordered `[leftX, leftY, rightX, rightY]` rows.
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
export type CalibrationSource = Record<string, unknown>;

/**
 * One camera pair in the portable calibration JSON file. This is the same
 * self-describing shape the desktop platform persists as the project's
 * standalone calibration.json (see desktop backend/native/common.ts), so a
 * panel-saved file, the on-disk artifact, and an import-time seed are all
 * interchangeable: correspondences flattened as [leftX, leftY, rightX,
 * rightY] rows, plus both fitted directions (null when unfitted).
 */
export interface CalibrationFilePair {
  left: string;
  right: string;
  points?: number[][];
  leftToRight?: Matrix3 | null;
  rightToLeft?: Matrix3 | null;
  transformType?: TransformType;
}

/** Portable calibration file: everything needed to restore all pairs. */
export interface CalibrationFile {
  /** Written by panel saves for self-identification; optional on load. */
  type?: string;
  version: number;
  /** Producer provenance, preserved verbatim across round trips. */
  source?: CalibrationSource | null;
  pairs: CalibrationFilePair[];
}

/** Identifying `type` value of the calibration JSON format. */
export const CALIBRATION_FILE_TYPE = 'dive-camera-calibration';

/** Picked correspondences keyed by {@link CameraCalibrationStore.pairKey}. */
export type CameraCorrespondences = Record<string, Correspondence[]>;

/** Chosen fit model per pair, keyed by {@link CameraCalibrationStore.pairKey}. Missing entries default to 'similarity'. */
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

  /**
   * Correspondence currently selected in the picking UI (grabbed marker /
   * clicked table row), highlighted in BOTH cameras' panes and deletable via
   * the panel or the Delete key. Authoring state only -- never persisted.
   */
  selectedCorrespondenceId: Ref<number | null>;

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

  /**
   * Provenance of the loaded calibration (see {@link CalibrationSource}).
   * Deliberately NOT cleared by in-app edits or refits -- refinements are
   * exactly what should travel back to the producer stamped with the model
   * lineage they were made against. Replaced (or cleared) only when a
   * calibration file is loaded or the store is re-hydrated.
   */
  source: Ref<CalibrationSource | null>;

  private nextId: number;

  private nextRecenterId: number;

  /** Provenance per homography key; missing entries behave like 'fit'. */
  private homographySources: Record<string, HomographySource>;

  constructor() {
    this.activePair = ref(null);
    this.pickingEnabled = ref(false);
    this.pendingPoint = ref(null);
    this.correspondences = ref({});
    this.homographies = ref({});
    this.transformTypes = ref({});
    this.alignment = ref({ mode: 'original', opacity: 0.5, pickTarget: 'native' });
    this.selectedCorrespondenceId = ref(null);
    this.cursorCoord = ref(null);
    this.recenterRequest = ref(null);
    this.fitError = ref(null);
    this.source = ref(null);
    this.nextId = 1;
    this.nextRecenterId = 1;
    this.homographySources = {};
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
    this.selectedCorrespondenceId.value = null;
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
    const list = this.correspondences.value[key];
    if (!list || !list.some((c) => c.id === id)) {
      return;
    }
    const side = camera === pair.camA ? 'a' : 'b';
    this.correspondences.value = {
      ...this.correspondences.value,
      [key]: list.map((c) => (c.id === id ? { ...c, [side]: coord } : c)),
    };
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

  /** Remove a correspondence (by id) from the active pair -- both cameras' points at once. */
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
    const list = key ? this.correspondences.value[key] : undefined;
    this.selectedCorrespondenceId.value = (list && list.some((c) => c.id === id)) ? id : null;
  }

  /** Remove the selected correspondence (both cameras' points). No-op without a selection. */
  removeSelectedCorrespondence() {
    const id = this.selectedCorrespondenceId.value;
    if (id !== null) {
      this.removeCorrespondence(id);
    }
  }

  /**
   * Drop all correspondences, the pending point, and any homography
   * (fitted or file-loaded) for the active pair.
   */
  clearPair() {
    const key = this.activePairKey();
    this.pendingPoint.value = null;
    this.selectedCorrespondenceId.value = null;
    if (!key) {
      return;
    }
    this.correspondences.value = { ...this.correspondences.value, [key]: [] };
    // Clearing is explicit: a file-loaded homography goes too. Dropping the
    // 'loaded' mark lets maybeFitPair remove it through the normal path.
    delete this.homographySources[key];
    this.maybeFitPair(key);
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
    if (this.selectedCorrespondenceId.value === list[list.length - 1].id) {
      this.selectedCorrespondenceId.value = null;
    }
    this.correspondences.value = { ...this.correspondences.value, [key]: list.slice(0, -1) };
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

  /** The chosen fit model for `key`, defaulting to 'similarity' when unset. */
  transformTypeForPair(key: string): TransformType {
    return this.transformTypes.value[key] || 'similarity';
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
      // A file-loaded homography has no backing points; it stays in place
      // until enough points are picked to fit a replacement (or the pair is
      // explicitly cleared, which drops its 'loaded' mark first).
      if (this.homographySources[key] !== 'loaded') {
        const rest = { ...this.homographies.value };
        delete rest[key];
        this.homographies.value = rest;
        delete this.homographySources[key];
        if (this.activePairKey() === key && this.alignment.value.mode !== 'original') {
          this.alignment.value = { ...this.alignment.value, mode: 'original', pickTarget: 'native' };
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
    this.homographySources[key] = 'fit';
    return { AtoB, BtoA };
  }

  /**
   * Serialize every pair with content (points and/or a homography) as the
   * portable calibration JSON file (see {@link CalibrationFile}). Pairs whose
   * only state is a transform-type choice are omitted.
   */
  toCalibrationJson(): string {
    const keys = new Set([
      ...Object.keys(this.correspondences.value).filter(
        (key) => this.correspondences.value[key].length > 0,
      ),
      ...Object.keys(this.homographies.value),
    ]);
    const pairs: CalibrationFilePair[] = [...keys].sort().map((key) => {
      const [left, right] = key.split('::');
      const homography = this.homographies.value[key] || null;
      return {
        left,
        right,
        points: (this.correspondences.value[key] || []).map((c) => [c.a[0], c.a[1], c.b[0], c.b[1]]),
        leftToRight: homography ? homography.AtoB : null,
        rightToLeft: homography ? homography.BtoA : null,
        transformType: this.transformTypeForPair(key),
      };
    });
    const file: CalibrationFile = {
      type: CALIBRATION_FILE_TYPE,
      version: 1,
      ...(this.source.value ? { source: this.source.value } : {}),
      pairs,
    };
    return JSON.stringify(file, null, 2);
  }

  /**
   * Parse and load a calibration JSON file (the format written by
   * {@link toCalibrationJson}), REPLACING all pairs' correspondences,
   * homographies, and transform types. The active pair selection and picking
   * toggle are left alone; the alignment ghost reverts to 'original' since
   * the transform under it changed wholesale. Throws a descriptive Error on
   * malformed input without touching current state. Returns the camera names
   * referenced by the file so callers can warn about ones missing from the
   * loaded dataset.
   */
  loadCalibrationText(text: string): { cameras: string[]; pairCount: number } {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('File is not valid JSON');
    }
    const file = data as Partial<CalibrationFile>;
    if (!Array.isArray(file?.pairs)) {
      throw new Error('Not a DIVE camera calibration file (expected a "pairs" list)');
    }
    const source = CameraCalibrationStore.readSource(file.source);
    const correspondences: CameraCorrespondences = {};
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
      correspondences[key] = (pair.points || []).map((row, j) => {
        const [ax, ay, bx, by] = CameraCalibrationStore.readPointsRow(row, `${context}, points row ${j + 1}`);
        // eslint-disable-next-line no-plusplus
        return { id: this.nextId++, a: [ax, ay] as Point, b: [bx, by] as Point };
      });
      const leftToRight = (pair.leftToRight === null || pair.leftToRight === undefined)
        ? null
        : CameraCalibrationStore.readMatrix(pair.leftToRight, `${context}, leftToRight`);
      const rightToLeft = (pair.rightToLeft === null || pair.rightToLeft === undefined)
        ? null
        : CameraCalibrationStore.readMatrix(pair.rightToLeft, `${context}, rightToLeft`);
      if (leftToRight || rightToLeft) {
        // If only one direction is present, derive the other by inversion
        // (readMatrix guarantees invertibility).
        homographies[key] = {
          AtoB: leftToRight ?? invert3(rightToLeft as Matrix3),
          BtoA: rightToLeft ?? invert3(leftToRight as Matrix3),
        };
      }
    });
    this.correspondences.value = correspondences;
    this.homographies.value = homographies;
    this.transformTypes.value = transformTypes;
    this.source.value = source;
    this.markHomographySources();
    this.pendingPoint.value = null;
    this.selectedCorrespondenceId.value = null;
    this.fitError.value = null;
    this.alignment.value = { ...this.alignment.value, mode: 'original', pickTarget: 'native' };
    return { cameras: [...cameras], pairCount: file.pairs.length };
  }

  /** Validate an untrusted `source` value: a plain object, or absent (-> null). */
  private static readSource(raw: unknown): CalibrationSource | null {
    if (raw === undefined || raw === null) {
      return null;
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('"source" must be an object when present');
    }
    return raw as CalibrationSource;
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
   * pair lacks enough points for its transform type can only have come from a
   * file ('loaded', so refit checks preserve it); one with enough points is
   * treated as fitted from them.
   */
  private markHomographySources() {
    this.homographySources = {};
    Object.keys(this.homographies.value).forEach((key) => {
      const count = (this.correspondences.value[key] || []).length;
      const required = minPointsForTransform(this.transformTypeForPair(key));
      this.homographySources[key] = count >= required ? 'fit' : 'loaded';
    });
  }

  /** Reset state and load saved homographies, correspondences, transform type choices, and provenance. */
  hydrate(
    homographies?: CameraHomographies,
    correspondences?: CameraCorrespondences,
    transformTypes?: CameraTransformTypes,
    source?: CalibrationSource | null,
  ) {
    this.homographies.value = homographies ? { ...homographies } : {};
    this.correspondences.value = correspondences ? { ...correspondences } : {};
    this.transformTypes.value = transformTypes ? { ...transformTypes } : {};
    this.source.value = source ?? null;
    this.markHomographySources();
    this.activePair.value = null;
    this.pendingPoint.value = null;
    this.pickingEnabled.value = false;
    this.alignment.value = { mode: 'original', opacity: 0.5, pickTarget: 'native' };
    this.selectedCorrespondenceId.value = null;
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
