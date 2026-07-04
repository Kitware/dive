import {
  computed, ref, ComputedRef, Ref,
} from 'vue';
import type { Matrix3, Point } from './homography';
import {
  cameraPairTransform, isIdentityMatrix3, mapPoint,
} from './alignedView';

/**
 * Shared reactive state for the multicam "aligned view" toggle: when every
 * non-reference camera has a stored/fitted transform into the reference
 * camera's space, the user may warp each camera's display into that shared
 * space during normal annotation review and link pan/zoom across all cameras
 * (SEAL-TK features 2 + 3).
 *
 * Stored annotation geometry ALWAYS remains in native image space (decision
 * D3); the transforms exposed here are applied at draw time only.
 */
export default class AlignedViewStore {
  /** User toggle: whether the aligned view is requested. */
  enabled: Ref<boolean>;

  /** Reference camera name (first camera in display order), null when unresolved. */
  reference: Ref<string | null>;

  /**
   * Per-camera native->reference matrices covering EVERY loaded camera, or
   * null when at least one camera lacks a usable transform (see
   * {@link resolveToReferenceTransforms}).
   */
  toReference: Ref<Record<string, Matrix3> | null>;

  /**
   * Externally suspended (e.g. while calibration point picking is active,
   * which records raw native-space clicks and manages its own aligned
   * preview). Suspension un-warps the display without losing the toggle.
   */
  suspended: Ref<boolean>;

  /** A usable transform exists for every camera, so the toggle may be shown. */
  available: ComputedRef<boolean>;

  /** The aligned view is currently applied to rendering and navigation. */
  active: ComputedRef<boolean>;

  constructor() {
    this.enabled = ref(false);
    this.reference = ref(null);
    this.toReference = ref(null);
    this.suspended = ref(false);
    this.available = computed(() => this.reference.value !== null
      && this.toReference.value !== null
      && Object.keys(this.toReference.value).length > 1);
    this.active = computed(() => this.enabled.value
      && !this.suspended.value
      && this.available.value);
  }

  /** Replace the resolved transform set (null when unavailable). */
  setTransforms(reference: string | null, toReference: Record<string, Matrix3> | null) {
    this.reference.value = reference;
    this.toReference.value = toReference;
  }

  setEnabled(enabled: boolean) {
    this.enabled.value = enabled;
  }

  setSuspended(suspended: boolean) {
    this.suspended.value = suspended;
  }

  /**
   * Display transform for `camera` (native -> aligned/reference space), or
   * null when the aligned view is inactive or the camera renders unwarped
   * (the reference camera / identity). Callers treat null as "draw exactly
   * as today", keeping the off state byte-identical to current behavior.
   */
  cameraTransform(camera: string): Matrix3 | null {
    if (!this.active.value || !this.toReference.value) {
      return null;
    }
    const matrix = this.toReference.value[camera];
    if (!matrix || isIdentityMatrix3(matrix)) {
      return null;
    }
    return matrix;
  }

  /**
   * Matrix mapping `from`-camera native pixels onto `to`-camera native
   * pixels, composed through the reference space. Null when inactive or
   * either camera is unresolved.
   */
  cameraToCamera(from: string, to: string): Matrix3 | null {
    if (!this.active.value || !this.toReference.value) {
      return null;
    }
    return cameraPairTransform(this.toReference.value, from, to);
  }

  /** Map a native-space point of `from` onto `to`'s native space (null when unavailable). */
  mapCameraPoint(from: string, to: string, point: Point): Point | null {
    const matrix = this.cameraToCamera(from, to);
    if (!matrix) {
      return null;
    }
    return mapPoint(matrix, point);
  }
}
