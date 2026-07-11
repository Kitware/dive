/**
 * The portable per-camera image-registration file format, shared by every
 * producer and consumer of <camera>_to_<reference>_registration.json files:
 * the desktop backend (persistence + export), the web client (export
 * downloads + import uploads), and the multicam import seed. One file per
 * non-reference camera, named for the mapping it carries (camera registers
 * onto the reference) and self-identified with
 * `type: 'dive-camera-registration'`; pair bodies name their own cameras,
 * so file names are discovery/provenance only.
 */
import {
  RegistrationFile, RegistrationFilePair, RegistrationSource,
  CameraCorrespondences, CameraHomographies, CameraTransformTypes,
  REGISTRATION_FILE_TYPE,
} from './CameraRegistrationStore';
import { DEFAULT_TRANSFORM_TYPE } from './transform';

/** The complete in-app calibration state for one dataset. */
export interface CameraRegistrationValues {
  homographies: CameraHomographies;
  correspondences: CameraCorrespondences;
  transformTypes: CameraTransformTypes;
  source: RegistrationSource | null;
}

/**
 * File name for one camera's registration. The destination (the camera it
 * registers onto -- normally the rig reference) is part of the name so the
 * file states its own direction: ir_to_eo_registration.json registers ir
 * onto eo. Omitted when the camera's pairs have no single partner.
 */
export function registrationFileName(camera: string, destination: string | null): string {
  return destination
    ? `${camera}_to_${destination}_registration.json`
    : `${camera}_registration.json`;
}

/**
 * Restrict a calibration to the pairs naming `camera` (either side). Used by
 * the per-camera import buttons so a multi-pair file only contributes the
 * chosen camera's pair(s).
 */
export function filterRegistrationValues(
  values: CameraRegistrationValues,
  camera: string,
): CameraRegistrationValues {
  const keep = (key: string) => key.split('::').includes(camera);
  const filterRecord = <T>(record: Record<string, T>): Record<string, T> => Object.fromEntries(
    Object.entries(record).filter(([key]) => keep(key)),
  );
  return {
    homographies: filterRecord(values.homographies),
    correspondences: filterRecord(values.correspondences),
    transformTypes: filterRecord(values.transformTypes),
    source: values.source,
  };
}

/** The distinct camera names and pair count a calibration holds. */
export function registrationValuesSummary(
  values: CameraRegistrationValues,
): { cameras: string[]; pairCount: number } {
  const keys = new Set([
    ...Object.keys(values.homographies),
    ...Object.keys(values.correspondences),
    ...Object.keys(values.transformTypes),
  ]);
  const cameras = new Set<string>();
  keys.forEach((key) => key.split('::').forEach((name) => cameras.add(name)));
  return { cameras: [...cameras], pairCount: keys.size };
}

/**
 * Convert the in-app calibration state (keyed by directional "left::right")
 * into the self-describing list of file pairs.
 */
function toRegistrationFilePairs(values: CameraRegistrationValues): RegistrationFilePair[] {
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
 * <camera>_to_<reference>_registration.json per non-reference camera
 * (reference = first camera in display order). A pair not touching the
 * reference files under its right camera, named for that pair's other side;
 * grouping is cosmetic either way since pair bodies are authoritative on
 * load.
 */
export function buildPerCameraRegistrationFiles(
  values: CameraRegistrationValues,
  referenceCamera: string | null,
): { camera: string; destination: string | null; name: string; body: RegistrationFile }[] {
  const pairsByCamera = new Map<string, RegistrationFilePair[]>();
  toRegistrationFilePairs(values).forEach((pair) => {
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
    .map(([camera, pairs]) => {
      // The camera this file's content warps onto: the single partner named
      // across its pairs (normally the rig reference). Multiple partners
      // leave the name destination-free rather than picking one arbitrarily.
      const partners = new Set(pairs.flatMap(
        (pair) => [pair.left, pair.right].filter((name) => name !== camera),
      ));
      const destination = partners.size === 1 ? [...partners][0] : null;
      return {
        camera,
        destination,
        name: registrationFileName(camera, destination),
        body: {
          type: REGISTRATION_FILE_TYPE,
          version: 1,
          ...(fileSource ? { source: fileSource } : {}),
          pairs,
        },
      };
    });
}

/**
 * Merge the per-file producer stamps of a calibration file set. All stamped
 * files agreeing (deep-equal) yields that stamp; disagreement yields a
 * composite `{ mixed: true, files: {...} }` so the client can surface a
 * mixed-generation warning instead of composing silently -- the failure mode
 * per-camera files invite is a rig assembled from files regenerated at
 * different times.
 */
export function mergeRegistrationSources(
  stamps: { file: string; source: RegistrationSource | null }[],
): RegistrationSource | null {
  const stamped = stamps.filter((entry) => entry.source !== null);
  if (stamped.length === 0) {
    return null;
  }
  const first = JSON.stringify(stamped[0].source);
  if (stamped.every((entry) => JSON.stringify(entry.source) === first)) {
    return stamped[0].source;
  }
  return {
    mixed: true,
    files: Object.fromEntries(stamps.map((entry) => [entry.file, entry.source])),
  };
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
export function mergeRegistrationValues(
  existing: CameraRegistrationValues,
  incoming: CameraRegistrationValues,
  incomingLabel: string,
): CameraRegistrationValues {
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
  let source: RegistrationSource | null;
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
