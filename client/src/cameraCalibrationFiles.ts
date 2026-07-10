/**
 * The portable per-camera calibration file format, shared by every producer
 * and consumer of calibration_<camera>.json files: the desktop backend
 * (persistence + export), the web client (export downloads + import
 * uploads), and the multicam import seed. One file per non-reference camera,
 * each self-identified with `type: 'dive-camera-calibration'`; pair bodies
 * name their own cameras, so file names are discovery/provenance only.
 */
import {
  CalibrationFile, CalibrationFilePair, CalibrationSource,
  CameraCorrespondences, CameraHomographies, CameraTransformTypes,
  CALIBRATION_FILE_TYPE,
} from './CameraCalibrationStore';
import { DEFAULT_TRANSFORM_TYPE } from './transform';

/** The complete in-app calibration state for one dataset. */
export interface CameraCalibrationValues {
  homographies: CameraHomographies;
  correspondences: CameraCorrespondences;
  transformTypes: CameraTransformTypes;
  source: CalibrationSource | null;
}

export function perCameraCalibrationFileName(camera: string): string {
  return `calibration_${camera}.json`;
}

/**
 * Convert the in-app calibration state (keyed by directional "left::right")
 * into the self-describing list of file pairs.
 */
function toCalibrationFilePairs(values: CameraCalibrationValues): CalibrationFilePair[] {
  const keys = new Set([
    ...Object.keys(values.homographies),
    ...Object.keys(values.correspondences),
    ...Object.keys(values.transformTypes),
  ]);
  return [...keys].map((key) => {
    const [left, right] = key.split('::');
    const homography = values.homographies[key];
    return {
      left,
      right,
      points: (values.correspondences[key] || []).map((c) => [c.a[0], c.a[1], c.b[0], c.b[1]]),
      leftToRight: homography ? homography.AtoB : null,
      rightToLeft: homography ? homography.BtoA : null,
      transformType: values.transformTypes[key] || DEFAULT_TRANSFORM_TYPE,
    };
  });
}

/**
 * Group a calibration into its per-camera file bodies: one self-identified
 * calibration_<camera>.json per non-reference camera (reference = first
 * camera in display order). A pair not touching the reference files under
 * its right camera; grouping is cosmetic either way since pair bodies are
 * authoritative on load.
 */
export function buildPerCameraCalibrationFiles(
  values: CameraCalibrationValues,
  referenceCamera: string | null,
): { camera: string; name: string; body: CalibrationFile }[] {
  const pairsByCamera = new Map<string, CalibrationFilePair[]>();
  toCalibrationFilePairs(values).forEach((pair) => {
    let camera = pair.right;
    if (referenceCamera !== null && pair.right === referenceCamera
      && pair.left !== referenceCamera) {
      camera = pair.left;
    }
    pairsByCamera.set(camera, [...(pairsByCamera.get(camera) ?? []), pair]);
  });
  // A mixed composite stamp describes the assembled SET, not any single file;
  // stamping every per-camera file with it would present a unanimous
  // (therefore "consistent") rig on the next load, hiding the very mismatch
  // it records. Per-file stamps resume with the next externally produced file.
  const fileSource = values.source
    && (values.source as Record<string, unknown>).mixed === true
    ? null
    : values.source;
  return [...pairsByCamera.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([camera, pairs]) => ({
      camera,
      name: perCameraCalibrationFileName(camera),
      body: {
        type: CALIBRATION_FILE_TYPE,
        version: 1,
        ...(fileSource ? { source: fileSource } : {}),
        pairs,
      },
    }));
}

/**
 * Merge a newly imported calibration into a dataset's existing one. Every
 * pair the import names replaces that pair wholly (points, transforms, and
 * model choice together -- a pair is one artifact); pairs it doesn't name
 * are kept, so per-camera files can be imported one at a time to assemble a
 * rig. Producer stamps follow the same policy as multi-file loading:
 * agreement keeps the stamp, disagreement is recorded as a
 * `{ mixed: true, files: {...} }` composite so the client can warn about a
 * rig assembled from different calibration generations.
 */
export function mergeCalibrationValues(
  existing: CameraCalibrationValues,
  incoming: CameraCalibrationValues,
  incomingLabel: string,
): CameraCalibrationValues {
  const homographies = { ...existing.homographies };
  const correspondences = { ...existing.correspondences };
  const transformTypes = { ...existing.transformTypes };
  const incomingKeys = new Set([
    ...Object.keys(incoming.homographies),
    ...Object.keys(incoming.correspondences),
    ...Object.keys(incoming.transformTypes),
  ]);
  incomingKeys.forEach((key) => {
    delete homographies[key];
    delete correspondences[key];
    delete transformTypes[key];
    if (incoming.homographies[key]) {
      homographies[key] = incoming.homographies[key];
    }
    if (incoming.correspondences[key]?.length) {
      correspondences[key] = incoming.correspondences[key];
    }
    if (incoming.transformTypes[key]) {
      transformTypes[key] = incoming.transformTypes[key];
    }
  });
  let source: CalibrationSource | null;
  if (incoming.source === null) {
    source = existing.source;
  } else if (existing.source === null
    || JSON.stringify(existing.source) === JSON.stringify(incoming.source)) {
    source = incoming.source;
  } else {
    source = {
      mixed: true,
      files: { previous: existing.source, [incomingLabel]: incoming.source },
    };
  }
  return {
    homographies, correspondences, transformTypes, source,
  };
}
