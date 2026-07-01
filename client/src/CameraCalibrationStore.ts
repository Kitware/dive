import { ref, Ref } from 'vue';
import {
  solveHomography, invert3, Matrix3, Point,
} from './homography';

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

/** Both directions of the fitted homography for one camera pair. */
export interface PairHomography {
  /** Maps left (camA) image coordinates onto right (camB). */
  AtoB: Matrix3;
  /** Maps right (camB) image coordinates onto left (camA). */
  BtoA: Matrix3;
}

/** Fitted homographies keyed by {@link CameraCalibrationStore.pairKey}. */
export type CameraHomographies = Record<string, PairHomography>;

/** Picked correspondences keyed by {@link CameraCalibrationStore.pairKey}. */
export type CameraCorrespondences = Record<string, Correspondence[]>;

export interface OverlayState {
  enabled: boolean;
  opacity: number;
  /** Which image to warp onto the other when overlaying. */
  direction: 'AtoB' | 'BtoA';
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

  overlay: Ref<OverlayState>;

  private nextId: number;

  constructor() {
    this.activePair = ref(null);
    this.pickingEnabled = ref(false);
    this.pendingPoint = ref(null);
    this.correspondences = ref({});
    this.homographies = ref({});
    this.overlay = ref({ enabled: false, opacity: 0.5, direction: 'AtoB' });
    this.nextId = 1;
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
    this.syncOverlayHomography();
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
    this.syncOverlayHomography();
  }

  /** Drop all correspondences and the pending point for the active pair. */
  clearPair() {
    const key = this.activePairKey();
    this.pendingPoint.value = null;
    if (!key) {
      return;
    }
    this.correspondences.value = { ...this.correspondences.value, [key]: [] };
    this.syncOverlayHomography();
  }

  /**
   * Fit the active pair when it has enough points; otherwise clear its homography
   * and turn off the overlay preview.
   */
  maybeFitActivePair() {
    const key = this.activePairKey();
    if (!key) {
      return;
    }
    const list = this.correspondences.value[key];
    if (!list || list.length < 4) {
      const { [key]: _removed, ...rest } = this.homographies.value;
      this.homographies.value = rest;
      if (this.overlay.value.enabled) {
        this.overlay.value = { ...this.overlay.value, enabled: false };
      }
      return;
    }
    this.fitHomography(key);
  }

  /** Enable or disable the overlay preview, fitting the homography when turning on. */
  setOverlayEnabled(enabled: boolean) {
    if (enabled) {
      this.maybeFitActivePair();
      const key = this.activePairKey();
      if (!key || !this.homographies.value[key]) {
        return;
      }
    }
    this.overlay.value = { ...this.overlay.value, enabled };
  }

  /** Re-fit the active pair while the overlay preview is enabled. */
  private syncOverlayHomography() {
    if (this.overlay.value.enabled) {
      this.maybeFitActivePair();
    }
  }

  /**
   * Fit a homography for `key` from its correspondences (>= 4 required). Computes
   * both directions and stores them. Returns the fitted pair.
   */
  fitHomography(key: string): PairHomography {
    const list = this.correspondences.value[key];
    if (!list || list.length < 4) {
      throw new Error('At least 4 point pairs are required to fit a homography');
    }
    const AtoB = solveHomography(list.map((c) => c.a), list.map((c) => c.b));
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

  /** Reset state and load saved homographies and correspondences. */
  hydrate(homographies?: CameraHomographies, correspondences?: CameraCorrespondences) {
    this.homographies.value = homographies ? { ...homographies } : {};
    this.correspondences.value = correspondences ? { ...correspondences } : {};
    this.activePair.value = null;
    this.pendingPoint.value = null;
    this.pickingEnabled.value = false;
    this.overlay.value = { enabled: false, opacity: 0.5, direction: 'AtoB' };
    // Resume id allocation past any restored correspondences.
    let maxId = 0;
    Object.values(this.correspondences.value).forEach((list) => {
      list.forEach((c) => { maxId = Math.max(maxId, c.id); });
    });
    this.nextId = maxId + 1;
  }
}
