/**
 * The portable per-camera image-registration file format (version 2), shared
 * by every producer and consumer of <camera>_to_<reference>_registration.json
 * files: the desktop backend (persistence + export), the web client (export
 * downloads + import uploads), the multicam import seed, and external
 * producers (the align_cameras pipeline, KAMERA). One file per non-reference
 * camera, named for the mapping it carries (camera registers onto the
 * reference) and self-identified with `type: 'dive-camera-registration'`;
 * pair bodies name their own cameras, so file names are discovery/provenance
 * only. Points live ONLY in per-image-pair `observations` -- image names are
 * the identity, frame indices are resolved by DIVE at load time, and each
 * observation carries its producer (`source`) and fit-inclusion (`enabled`)
 * state.
 */
import {
  RegistrationFile, RegistrationFilePair, RegistrationFileObservation, RegistrationSource,
  CameraObservations, CameraHomographies, CameraTransformTypes, CorrespondenceObservation,
  REGISTRATION_FILE_TYPE, REGISTRATION_FILE_VERSION,
} from './CameraRegistrationStore';
import { DEFAULT_TRANSFORM_TYPE } from './transform';

/** The complete in-app calibration state for one dataset. */
export interface CameraRegistrationValues {
  homographies: CameraHomographies;
  observations: CameraObservations;
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
    observations: filterRecord(values.observations),
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
    ...Object.keys(values.observations),
    ...Object.keys(values.transformTypes),
  ]);
  const cameras = new Set<string>();
  keys.forEach((key) => key.split('::').forEach((name) => cameras.add(name)));
  return { cameras: [...cameras], pairCount: keys.size };
}

/** Serialize one in-app observation as its file row. */
function toFileObservation(obs: CorrespondenceObservation): RegistrationFileObservation {
  return {
    // The frame index is advisory (dataset-local; DIVE re-resolves from the
    // image names on load) but useful to human readers and cheap to carry.
    ...(obs.frame !== null ? { frame: obs.frame } : {}),
    imageLeft: obs.imageA,
    imageRight: obs.imageB,
    enabled: obs.enabled,
    source: obs.source,
    points: obs.points.map((c) => [c.a[0], c.a[1], c.b[0], c.b[1]]),
    ...(obs.stats !== undefined ? { stats: obs.stats } : {}),
  };
}

/**
 * Convert the in-app calibration state (keyed by directional "left::right")
 * into the self-describing list of file pairs.
 */
function toRegistrationFilePairs(values: CameraRegistrationValues): RegistrationFilePair[] {
  const keys = new Set([
    ...Object.keys(values.homographies),
    ...Object.keys(values.observations),
    ...Object.keys(values.transformTypes),
  ]);
  return [...keys].map((key) => {
    const [left, right] = key.split('::');
    const homography = values.homographies[key];
    return {
      left,
      right,
      observations: (values.observations[key] || []).map(toFileObservation),
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
          version: REGISTRATION_FILE_VERSION,
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
 * Warning for a registration file naming cameras a dataset doesn't have,
 * shared by the desktop and web import seeding paths. Pair bodies are
 * authoritative on load, so such pairs import fine but never resolve in the
 * Aligned View. A warning rather than a failure: the mismatch may be
 * intentional (a rig file shared across datasets) or fixable later. Null
 * when every named camera is known.
 */
export function unknownCameraWarning(
  fileName: string,
  namedCameras: string[],
  datasetCameras: string[],
): string | null {
  const unknown = [...new Set(namedCameras)]
    .filter((name) => !datasetCameras.includes(name))
    .sort();
  if (!unknown.length) {
    return null;
  }
  return `Registration file "${fileName}" names camera(s) not in this dataset: `
    + `${unknown.join(', ')}. Pairs bind by the camera names in the file, so these `
    + 'transforms will not take effect unless camera names match.';
}

/**
 * Identity of one observation within a pair: the image pair plus producer.
 *
 * NUL separates the parts because it is the one character that cannot occur
 * in a filename, so no combination of names can collide by straddling a
 * delimiter. Write it as the `\0` escape, never as a literal control
 * character -- an actual NUL byte in the source makes the file read as
 * binary, and tools quietly skip it (grep needs -a, diffs degrade).
 */
function observationIdentity(obs: CorrespondenceObservation): string {
  return `${obs.imageA}\0${obs.imageB}\0${obs.source}`;
}

/**
 * Merge a newly imported calibration into a dataset's existing one, AT
 * OBSERVATION GRANULARITY within each pair: an incoming observation replaces
 * the existing observation with the same (image pair, source) identity, and
 * observations the import doesn't name -- e.g. hand-picked ones on other
 * frames -- are kept, so importing a fresh pipeline result updates the image
 * pairs it covers without discarding manual work. The incoming pair's
 * matrices and model choice replace the existing pair's (they describe the
 * newest fit); pairs the import doesn't name at all are kept untouched, so
 * per-camera files can be imported one at a time to assemble a rig.
 * Producer stamps follow the same policy as multi-file loading: agreement
 * keeps the stamp, disagreement is recorded as a
 * `{ mixed: true, files: {...} }` composite so the client can warn about a
 * rig assembled from different calibration generations.
 */
export function mergeRegistrationValues(
  existing: CameraRegistrationValues,
  incoming: CameraRegistrationValues,
  incomingLabel: string,
): CameraRegistrationValues {
  const homographies = { ...existing.homographies };
  const observations = { ...existing.observations };
  const transformTypes = { ...existing.transformTypes };
  const incomingKeys = new Set([
    ...Object.keys(incoming.homographies),
    ...Object.keys(incoming.observations),
    ...Object.keys(incoming.transformTypes),
  ]);
  incomingKeys.forEach((key) => {
    delete homographies[key];
    delete transformTypes[key];
    if (incoming.homographies[key]) {
      homographies[key] = incoming.homographies[key];
    }
    if (incoming.transformTypes[key]) {
      transformTypes[key] = incoming.transformTypes[key];
    }
    const incomingList = incoming.observations[key] || [];
    if (incomingList.length) {
      const replaced = new Set(incomingList.map(observationIdentity));
      observations[key] = [
        ...(observations[key] || []).filter((obs) => !replaced.has(observationIdentity(obs))),
        ...incomingList,
      ];
    } else if (incoming.homographies[key] || incoming.transformTypes[key]) {
      // A matrix-only incoming pair (e.g. a producer file with no points)
      // still replaces the pair as an artifact, points included -- matching
      // the pre-observations behavior where a named pair replaced wholly.
      delete observations[key];
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
    homographies, observations, transformTypes, source,
  };
}
