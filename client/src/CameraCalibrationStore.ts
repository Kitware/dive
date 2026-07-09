import {
  ref, computed, Ref, ComputedRef,
} from 'vue';
import {
  invert3, Matrix3, Point,
} from './homography';
import {
  TransformType, TRANSFORM_TYPES, DEFAULT_TRANSFORM_TYPE, minPointsForTransform,
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

/**
 * Shared, reactive store for camera-calibration data (correspondences,
 * fitted/loaded homographies, transform-type choices, and producer
 * provenance). Lives in vue-media-annotator so both the annotation layers
 * (client/src/layers) and the dive-common side can consume it via the
 * provide/inject system. Handles persistence: hydrating saved state and
 * loading/saving the portable calibration JSON format.
 */
export default class CameraCalibrationStore {
  correspondences: Ref<CameraCorrespondences>;

  homographies: Ref<CameraHomographies>;

  transformTypes: Ref<CameraTransformTypes>;

  /**
   * Provenance of the loaded calibration (see {@link CalibrationSource}).
   * Deliberately NOT cleared by in-app edits or refits -- refinements are
   * exactly what should travel back to the producer stamped with the model
   * lineage they were made against. Replaced (or cleared) only when a
   * calibration file is loaded or the store is re-hydrated.
   */
  source: Ref<CalibrationSource | null>;

  /** True when the calibration has unsaved changes since the last save or load. */
  dirty: ComputedRef<boolean>;

  private nextId: number;

  /** Provenance per homography key; missing entries behave like 'fit'. */
  private homographySources: Record<string, HomographySource>;

  /** Serialized calibration at the last save/load, the baseline for {@link dirty}. */
  private savedSnapshot: Ref<string>;

  constructor() {
    this.correspondences = ref({});
    this.homographies = ref({});
    this.transformTypes = ref({});
    this.source = ref(null);
    this.nextId = 1;
    this.homographySources = {};
    this.savedSnapshot = ref(this.calibrationSnapshot());
    this.dirty = computed(() => this.calibrationSnapshot() !== this.savedSnapshot.value);
  }

  /** Serialize the saved-to-dataset calibration state (points, transforms, provenance). */
  private calibrationSnapshot(): string {
    return JSON.stringify({
      homographies: this.homographies.value,
      correspondences: this.correspondences.value,
      transformTypes: this.transformTypes.value,
      source: this.source.value,
    });
  }

  /** Capture the current calibration as the saved baseline, so {@link dirty} reads false. */
  markSaved() {
    this.savedSnapshot.value = this.calibrationSnapshot();
  }

  /**
   * Directional key for a camera pair: `left::right`. Order is significant and
   * preserved so left/right (e.g. RGB vs IR) survives for ordered exports.
   */
  // eslint-disable-next-line class-methods-use-this
  pairKey(camA: string, camB: string): string {
    return `${camA}::${camB}`;
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

  /** The chosen fit model for `key`, defaulting to {@link DEFAULT_TRANSFORM_TYPE} when unset. */
  transformTypeForPair(key: string): TransformType {
    return this.transformTypes.value[key] || DEFAULT_TRANSFORM_TYPE;
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
   * homographies, and transform types. Throws a descriptive Error on
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
    // Resume id allocation past any restored correspondences.
    let maxId = 0;
    Object.values(this.correspondences.value).forEach((list) => {
      list.forEach((c) => { maxId = Math.max(maxId, c.id); });
    });
    this.nextId = maxId + 1;
    // The freshly loaded state is the saved baseline.
    this.markSaved();
  }
}
