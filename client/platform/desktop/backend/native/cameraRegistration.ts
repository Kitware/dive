/**
 * Camera-to-camera registration file I/O for the desktop backend.
 *
 * Registration transforms are stored as standalone per-camera
 * *_registration.json files in the dataset directory rather than embedded in
 * meta.json.
 */

import npath from 'path';
import fs from 'fs-extra';

import { TransformType, DEFAULT_TRANSFORM_TYPE } from 'vue-media-annotator/alignedView/transform';
import { REGISTRATION_FILE_TYPE } from 'vue-media-annotator/alignedView/CameraRegistrationStore';
import {
  buildPerCameraRegistrationFiles, registrationValuesSummary, filterRegistrationValues,
  mergeRegistrationValues, CameraRegistrationValues,
} from 'vue-media-annotator/alignedView/cameraRegistrationFiles';
import { readTransformMatrix } from 'vue-media-annotator/alignedView/alignedView';
import { invert3, Matrix3 } from 'vue-media-annotator/alignedView/homography';
import { DatasetMetaMutable } from 'dive-common/apispec';
import { referenceCameraName as multicamReferenceCameraName } from 'dive-common/multicamDisplay';
import { JsonMeta, Settings } from 'platform/desktop/constants';

// eslint-disable-next-line import/no-cycle
import {
  getValidatedProjectDir, loadJsonMetadata, saveMetadata,
} from './common';

/** Matches per-camera registration files in a dataset directory. */
export const RegistrationFileNamePattern = /^.+_registration\.json$/i;

export type CameraHomographies = NonNullable<DatasetMetaMutable['cameraHomographies']>;
export type CameraCorrespondences = NonNullable<DatasetMetaMutable['cameraCorrespondences']>;
export type CameraTransformTypes = NonNullable<DatasetMetaMutable['cameraTransformTypes']>;
export type RegistrationSource = NonNullable<DatasetMetaMutable['cameraRegistrationSource']>;

/**
 * Best-effort read of the calibration file's producer provenance stamp: a
 * plain object, or null for anything else. Preserved verbatim across
 * load/refine/save round trips; never interpreted by DIVE.
 */
export function readRegistrationSource(raw: unknown): RegistrationSource | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as RegistrationSource;
  }
  return null;
}

/**
 * One camera pair in calibration.json. `left`/`right` are camera (folder) names;
 * `points` are the picked correspondences as rows of `leftX leftY rightX rightY`;
 * `leftToRight`/`rightToLeft` are the fitted
 * 3x3 homographies, when a fit has been performed; `transformType` is the fit
 * model used to compute them (defaults to {@link DEFAULT_TRANSFORM_TYPE} when
 * absent, matching the in-app default so a pair fitted at the default resolves
 * to the same model after a save/reload).
 */
export interface RegistrationPair {
  left: string;
  right: string;
  points: number[][];
  leftToRight: number[][] | null;
  rightToLeft: number[][] | null;
  transformType?: TransformType;
}

/** Rebuild the in-app homographies/correspondences/transform types from calibration.json pairs. */
export function fromRegistrationPairs(
  pairs: RegistrationPair[],
): {
  homographies: CameraHomographies;
  correspondences: CameraCorrespondences;
  transformTypes: CameraTransformTypes;
} {
  const homographies: CameraHomographies = {};
  const correspondences: CameraCorrespondences = {};
  const transformTypes: CameraTransformTypes = {};
  pairs.forEach((pair) => {
    const key = `${pair.left}::${pair.right}`;
    // Mirror the panel loader (CameraRegistrationStore.loadRegistrationText):
    // producer files may carry only one fitted direction, so derive the
    // missing one by inversion. A singular matrix can't participate in the
    // warp either way, so such pairs contribute points only.
    if (pair.leftToRight || pair.rightToLeft) {
      try {
        homographies[key] = {
          AtoB: pair.leftToRight ?? invert3(pair.rightToLeft as Matrix3),
          BtoA: pair.rightToLeft ?? invert3(pair.leftToRight as Matrix3),
        };
      } catch {
        // Singular / non-invertible: skip the matrix, keep the points.
      }
    }
    if (pair.points && pair.points.length) {
      correspondences[key] = pair.points.map((p, i) => ({
        id: i + 1, a: [p[0], p[1]], b: [p[2], p[3]],
      }));
    }
    transformTypes[key] = pair.transformType || DEFAULT_TRANSFORM_TYPE;
  });
  return { homographies, correspondences, transformTypes };
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

async function writeJsonFile(absPath: string, data: unknown): Promise<void> {
  await fs.writeFile(absPath, JSON.stringify(data, null, 2));
}

/**
 * Read and merge every per-camera *_registration.json in a dataset
 * directory, sorted by name for determinism. Pair bodies are authoritative
 * (file names are ignored for binding); a pair key appearing in more than
 * one file keeps the last occurrence with a warning. `found` is true when at
 * least one file parsed as a calibration, so callers can distinguish "no
 * calibration files" from an empty one.
 */
export async function loadRegistrationFiles(basePath: string): Promise<{
  found: boolean;
  homographies: CameraHomographies;
  correspondences: CameraCorrespondences;
  transformTypes: CameraTransformTypes;
  source: RegistrationSource | null;
}> {
  let names: string[] = [];
  try {
    const entries = await fs.readdir(basePath, { withFileTypes: true });
    names = entries
      .filter((entry) => entry.isFile() && RegistrationFileNamePattern.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    // Unreadable directory: treated the same as no calibration files.
  }
  let found = false;
  const mergedPairs = new Map<string, RegistrationPair>();
  const stamps: { file: string; source: RegistrationSource | null }[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const name of names) {
    const absPath = npath.join(basePath, name);
    try {
      // eslint-disable-next-line no-await-in-loop -- files merged in deterministic order
      const calibration = await fs.readJson(absPath);
      if (calibration && Array.isArray(calibration.pairs)) {
        found = true;
        (calibration.pairs as RegistrationPair[]).forEach((pair) => {
          const key = `${pair.left}::${pair.right}`;
          if (mergedPairs.has(key)) {
            console.warn(`Calibration pair ${key} appears in multiple files; keeping ${name}`);
          }
          mergedPairs.set(key, pair);
        });
        stamps.push({ file: name, source: readRegistrationSource(calibration.source) });
      }
    } catch (err) {
      // A malformed calibration file should not block loading the dataset.
      console.warn(`Unable to read ${absPath}: ${err}`);
    }
  }
  return {
    found,
    ...fromRegistrationPairs([...mergedPairs.values()]),
    source: mergeRegistrationSources(stamps),
  };
}

/** The reference camera a dataset's pairs group against: the import dialog's
 * Reference Camera choice (stored as defaultDisplay), falling back to the
 * first camera in display order.
 */
export function referenceCameraName(meta: JsonMeta): string | null {
  return meta.multiCam ? multicamReferenceCameraName(meta.multiCam) : null;
}

/**
 * The calibration a dataset currently resolves to, from the same sources
 * loadMetadata uses: the standalone per-camera files, or the import-time
 * seed in the dataset meta when no files have been written yet.
 */
export async function loadEffectiveRegistration(
  basePath: string,
  meta: JsonMeta,
): Promise<CameraRegistrationValues> {
  const onDisk = await loadRegistrationFiles(basePath);
  if (onDisk.found) {
    return onDisk;
  }
  return {
    homographies: meta.cameraHomographies ?? {},
    correspondences: meta.cameraCorrespondences ?? {},
    transformTypes: meta.cameraTransformTypes ?? {},
    source: meta.cameraRegistrationSource ?? null,
  };
}

/**
 * Persist camera registration to standalone per-camera files in a dataset
 * directory, merging partial updates with whatever is already on disk.
 */
export async function saveRegistrationToDatasetDir(
  basePath: string,
  args: Pick<DatasetMetaMutable,
  'cameraHomographies' | 'cameraCorrespondences' | 'cameraTransformTypes' | 'cameraRegistrationSource'>,
  referenceCamera: string | null,
): Promise<void> {
  const onDisk = await loadRegistrationFiles(basePath);
  let {
    homographies, correspondences, transformTypes, source,
  } = onDisk;
  if (args.cameraHomographies) {
    homographies = args.cameraHomographies;
  }
  if (args.cameraCorrespondences) {
    correspondences = args.cameraCorrespondences;
  }
  if (args.cameraTransformTypes) {
    transformTypes = args.cameraTransformTypes;
  }
  // undefined leaves the on-disk stamp alone; null/object replaces it.
  if (args.cameraRegistrationSource !== undefined) {
    source = args.cameraRegistrationSource;
  }
  const files = buildPerCameraRegistrationFiles(
    {
      homographies, correspondences, transformTypes, source,
    },
    referenceCamera,
  );
  const expected = new Set(files.map((file) => file.name));
  await Promise.all(files.map((file) => writeJsonFile(npath.join(basePath, file.name), file.body)));
  // Remove any per-camera file whose pairs no longer exist (e.g. a cleared
  // pair), so the on-disk set always mirrors the saved calibration exactly.
  try {
    const entries = await fs.readdir(basePath, { withFileTypes: true });
    await Promise.all(entries
      .filter((entry) => entry.isFile()
        && !expected.has(entry.name)
        && RegistrationFileNamePattern.test(entry.name))
      .map((entry) => fs.remove(npath.join(basePath, entry.name))));
  } catch (err) {
    console.warn(`Unable to clean up stale calibration files: ${err}`);
  }
}

/**
 * Find every DIVE camera-calibration .json (alignment transforms, the
 * calibration save format) in the parent folder root, for auto-attaching at
 * multicam import time. Only files that self-identify with
 * `type: 'dive-camera-calibration'` qualify, so a camera-rig calibration
 * .json or other stray JSON in the collect root is never grabbed by mistake.
 * Ordered for deterministic attachment: per-camera *_registration.json
 * files first, then any other self-identified candidates, alphabetically
 * within each group.
 */
export async function findParentFolderTransformFiles(parentPath: string): Promise<string[]> {
  if (!await fs.pathExists(parentPath)) {
    return [];
  }
  const stat = await fs.stat(parentPath);
  if (!stat.isDirectory()) {
    return [];
  }
  const children = await fs.readdir(parentPath, { withFileTypes: true });
  const rank = (name: string) => (RegistrationFileNamePattern.test(name) ? 0 : 1);
  const candidates = children
    .filter((entry) => entry.isFile() && /\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const found: string[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const name of candidates) {
    const absPath = npath.join(parentPath, name);
    try {
      // eslint-disable-next-line no-await-in-loop -- candidates checked in priority order
      const data = await fs.readJson(absPath);
      if (data && data.type === REGISTRATION_FILE_TYPE && Array.isArray(data.pairs)) {
        found.push(absPath);
      }
    } catch {
      // Unreadable/non-JSON candidates are simply not matches.
    }
  }
  return found;
}

/**
 * Export one camera's registration as its *_registration.json file to destPath.
 * @returns the destination path written
 */
export async function exportCameraRegistration(
  settings: Settings,
  datasetId: string,
  destPath: string,
  camera: string,
): Promise<string> {
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId.split('/')[0]);
  const meta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  const calibration = await loadEffectiveRegistration(projectDirInfo.basePath, meta);
  const files = buildPerCameraRegistrationFiles(calibration, referenceCameraName(meta));
  if (!files.length) {
    throw new Error(`Dataset ${datasetId} has no camera registration to export.`);
  }
  const match = files.find((file) => file.camera === camera);
  if (!match) {
    throw new Error(`Dataset ${datasetId} has no registration for camera "${camera}".`);
  }
  await writeJsonFile(destPath, match.body);
  return destPath;
}

/**
 * Import a DIVE registration .json into an existing dataset, merging its
 * pairs over the current set: with options.camera, only the file's
 * pairs naming that camera are taken; each imported pair replaces that pair
 * wholly and other pairs are kept, so per-camera files can be imported one
 * at a time. Persists through saveMetadata, which rewrites the standalone
 * per-camera files.
 */
export async function importCameraRegistration(
  settings: Settings,
  datasetId: string,
  filePath: string,
  options: { camera?: string } = {},
): Promise<{ cameras: string[]; pairCount: number }> {
  const parentId = datasetId.split('/')[0];
  const projectDirInfo = await getValidatedProjectDir(settings, parentId);
  const meta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  let data;
  try {
    data = await fs.readJson(filePath);
  } catch {
    throw new Error('File is not valid JSON');
  }
  if (!data || !Array.isArray(data.pairs)) {
    throw new Error('Not a DIVE camera registration file (expected a "pairs" list)');
  }
  let incoming: CameraRegistrationValues = {
    ...fromRegistrationPairs(data.pairs),
    source: readRegistrationSource(data.source),
  };
  if (options.camera !== undefined) {
    incoming = filterRegistrationValues(incoming, options.camera);
  }
  const summary = registrationValuesSummary(incoming);
  if (!summary.pairCount) {
    throw new Error(options.camera !== undefined
      ? `File has no pairs for camera "${options.camera}"`
      : 'File has no pairs');
  }
  Object.entries(incoming.homographies).forEach(([key, homography]) => {
    if (!readTransformMatrix(homography.AtoB) || !readTransformMatrix(homography.BtoA)) {
      throw new Error(`Pair "${key.split('::').join(' / ')}" has an invalid 3x3 transform matrix`);
    }
  });
  const merged = mergeRegistrationValues(
    await loadEffectiveRegistration(projectDirInfo.basePath, meta),
    incoming,
    npath.basename(filePath),
  );
  await saveMetadata(settings, parentId, {
    cameraHomographies: merged.homographies,
    cameraCorrespondences: merged.correspondences,
    cameraTransformTypes: merged.transformTypes,
    cameraRegistrationSource: merged.source,
  });
  return summary;
}
