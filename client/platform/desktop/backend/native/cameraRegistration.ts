/**
 * Camera-to-camera registration file I/O for the desktop backend.
 *
 * Registration transforms are stored as standalone per-camera
 * *_registration.json files in the dataset directory rather than embedded in
 * dataset.json (or legacy meta.json).
 */

import npath from 'path';
import fs from 'fs-extra';

import { TransformType, DEFAULT_TRANSFORM_TYPE } from 'vue-media-annotator/alignedView/transform';
import {
  buildPerCameraRegistrationFiles, registrationValuesSummary, filterRegistrationValues,
  mergeRegistrationValues, mergeRegistrationSources, CameraRegistrationValues,
} from 'vue-media-annotator/alignedView/cameraRegistrationFiles';
import { readTransformMatrix } from 'vue-media-annotator/alignedView/alignedView';
import { invert3, Matrix3 } from 'vue-media-annotator/alignedView/homography';
import { DatasetConfigMutable } from 'dive-common/apispec';
import { referenceCameraName as multicamReferenceCameraName } from 'dive-common/multicamDisplay';
import {
  RegistrationFileNamePattern,
  compareRegistrationCandidates,
  qualifiesAsRegistrationFile,
} from 'dive-common/registrationParentFolder';
import { JsonConfig, Settings } from 'platform/desktop/constants';

import {
  getValidatedProjectDir, loadJsonConfig, saveConfig,
} from './common';

export type CameraHomographies = NonNullable<DatasetConfigMutable['cameraHomographies']>;
export type CameraObservations = NonNullable<DatasetConfigMutable['cameraCorrespondences']>;
export type CameraTransformTypes = NonNullable<DatasetConfigMutable['cameraTransformTypes']>;
export type RegistrationSource = NonNullable<DatasetConfigMutable['cameraRegistrationSource']>;

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
 * One observation row in a registration file pair: the points contributed by
 * one image pair, identified by its image names (`frame` is advisory --
 * producers may not know this dataset's indices; the client re-resolves).
 */
export interface RegistrationObservation {
  frame?: number | null;
  imageLeft: string;
  imageRight: string;
  enabled?: boolean;
  source?: string;
  points?: number[][];
  stats?: Record<string, unknown>;
}

/**
 * One camera pair in a registration file (format v2). `left`/`right` are
 * camera (folder) names; `observations` carry the per-image-pair points as
 * rows of `leftX leftY rightX rightY`; `leftToRight`/`rightToLeft` are the
 * fitted 3x3 homographies, when a fit has been performed; `transformType` is
 * the fit model used to compute them (defaults to
 * {@link DEFAULT_TRANSFORM_TYPE} when absent, matching the in-app default so
 * a pair fitted at the default resolves to the same model after a
 * save/reload).
 */
export interface RegistrationPair {
  left: string;
  right: string;
  observations?: RegistrationObservation[];
  leftToRight: number[][] | null;
  rightToLeft: number[][] | null;
  transformType?: TransformType;
}

/** Rebuild the in-app homographies/observations/transform types from registration file pairs. */
export function fromRegistrationPairs(
  pairs: RegistrationPair[],
): {
  homographies: CameraHomographies;
  observations: CameraObservations;
  transformTypes: CameraTransformTypes;
} {
  const homographies: CameraHomographies = {};
  const observations: CameraObservations = {};
  const transformTypes: CameraTransformTypes = {};
  let nextId = 0;
  pairs.forEach((pair) => {
    const key = `${pair.left}::${pair.right}`;
    // Mirror the shared client parser (CameraRegistrationStore.loadRegistrationText):
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
    if (pair.observations && pair.observations.length) {
      observations[key] = pair.observations.map((obs) => ({
        imageA: obs.imageLeft,
        imageB: obs.imageRight,
        // The client re-resolves frames from the image names on hydrate;
        // the stored value is a fallback for resolver-less contexts.
        frame: obs.frame ?? null,
        enabled: obs.enabled ?? true,
        source: obs.source || 'manual',
        ...(obs.stats !== undefined ? { stats: obs.stats } : {}),
        points: (obs.points || []).map((p) => {
          nextId += 1;
          return { id: nextId, a: [p[0], p[1]] as [number, number], b: [p[2], p[3]] as [number, number] };
        }),
      }));
    }
    transformTypes[key] = pair.transformType || DEFAULT_TRANSFORM_TYPE;
  });
  return { homographies, observations, transformTypes };
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
  observations: CameraObservations;
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
        // One format, one loader: a pre-v2 file has no observations, and
        // accepting it would load a matrix-only pair with its points
        // silently dropped -- indistinguishable from a real producer file.
        // Skip it loudly instead.
        if (calibration.version !== 2) {
          console.warn(
            `Skipping ${absPath}: unsupported registration file version `
            + `${JSON.stringify(calibration.version)} (expected 2). Regenerate it `
            + 'with a current producer.',
          );
          // eslint-disable-next-line no-continue
          continue;
        }
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
export function referenceCameraName(meta: JsonConfig): string | null {
  return meta.multiCam ? multicamReferenceCameraName(meta.multiCam) : null;
}

/**
 * The calibration a dataset currently resolves to, from the same sources
 * loadConfig uses: the standalone per-camera files, or the import-time
 * seed in the dataset meta when no files have been written yet.
 */
export async function loadEffectiveRegistration(
  basePath: string,
  meta: JsonConfig,
): Promise<CameraRegistrationValues> {
  const onDisk = await loadRegistrationFiles(basePath);
  if (onDisk.found) {
    return onDisk;
  }
  return {
    homographies: meta.cameraHomographies ?? {},
    observations: meta.cameraCorrespondences ?? {},
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
  args: Pick<DatasetConfigMutable,
  'cameraHomographies' | 'cameraCorrespondences' | 'cameraTransformTypes' | 'cameraRegistrationSource'>,
  referenceCamera: string | null,
): Promise<void> {
  const onDisk = await loadRegistrationFiles(basePath);
  let {
    homographies, observations, transformTypes, source,
  } = onDisk;
  if (args.cameraHomographies) {
    homographies = args.cameraHomographies;
  }
  if (args.cameraCorrespondences) {
    observations = args.cameraCorrespondences;
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
      homographies, observations, transformTypes, source,
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
 * Find every DIVE camera-registration .json (alignment transforms, the
 * registration panel's save format) in the parent folder root, for
 * auto-attaching at multicam import time -- the filesystem counterpart of
 * the web File-list scan (findRegistrationFilesInFileList); both share the
 * qualification rule and attachment order of
 * dive-common/registrationParentFolder.
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
  const candidates = children
    .filter((entry) => entry.isFile() && /\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareRegistrationCandidates);
  const found: string[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const name of candidates) {
    const absPath = npath.join(parentPath, name);
    try {
      // eslint-disable-next-line no-await-in-loop -- candidates checked in priority order
      const data = await fs.readJson(absPath);
      if (qualifiesAsRegistrationFile(name, data)) {
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
  const meta = await loadJsonConfig(projectDirInfo.datasetFileAbsPath);
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
 * at a time. Persists through saveConfig, which rewrites the standalone
 * per-camera files.
 */
export async function importCameraRegistration(
  settings: Settings,
  datasetId: string,
  filePath: string,
  options: { camera?: string } = {},
): Promise<{ cameras: string[]; pairCount: number }> {
  let data;
  try {
    data = await fs.readJson(filePath);
  } catch {
    throw new Error('File is not valid JSON');
  }
  return importCameraRegistrationData(settings, datasetId, data, npath.basename(filePath), options);
}

/**
 * Merge parsed registration data into a dataset (see
 * {@link importCameraRegistration}); also the ingest point for pipeline
 * outputs, which arrive as already-read JSON.
 */
export async function importCameraRegistrationData(
  settings: Settings,
  datasetId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  label: string,
  options: { camera?: string } = {},
): Promise<{ cameras: string[]; pairCount: number }> {
  const parentId = datasetId.split('/')[0];
  const projectDirInfo = await getValidatedProjectDir(settings, parentId);
  const meta = await loadJsonConfig(projectDirInfo.datasetFileAbsPath);
  if (!data || !Array.isArray(data.pairs)) {
    throw new Error('Not a DIVE camera registration file (expected a "pairs" list)');
  }
  if (data.version !== 2) {
    throw new Error(
      `Unsupported registration file version ${JSON.stringify(data.version)} `
      + '(expected 2). Regenerate the file with a current producer; pre-v2 '
      + 'files have no per-image-pair observations.',
    );
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
    label,
  );
  await saveConfig(settings, parentId, {
    cameraHomographies: merged.homographies,
    cameraCorrespondences: merged.observations,
    cameraTransformTypes: merged.transformTypes,
    cameraRegistrationSource: merged.source,
  });
  return summary;
}

/**
 * Ingest an align_cameras pipeline output (registration JSON in the job
 * work dir) into the dataset's saved registration. Frame-subset jobs on
 * video cameras run over extracted stills named <camera>.frame_<N>.png, so
 * such observation image names are mapped back to the frame://N
 * pseudo-identities the client resolves; image-sequence names pass through
 * (the extracted-or-original basenames are the dataset's own image names).
 * Merging happens at observation granularity via the shared writers, which
 * re-group pairs under DIVE's own reference camera -- the pipeline never
 * needs to know it.
 */
export async function ingestPipelineRegistration(
  settings: Settings,
  datasetId: string,
  filePath: string,
  videoCameras: string[],
): Promise<{ cameras: string[]; pairCount: number }> {
  const data = await fs.readJson(filePath);
  if (data && Array.isArray(data.pairs) && videoCameras.length) {
    const videoSet = new Set(videoCameras);
    const remap = (name: unknown, camera: string) => {
      if (typeof name !== 'string' || !videoSet.has(camera)) {
        return name;
      }
      const match = /\.frame_(\d+)\.\w+$/.exec(name);
      return match ? `frame://${Number(match[1])}` : name;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.pairs.forEach((pair: any) => {
      (pair?.observations ?? []).forEach((obs: Record<string, unknown>) => {
        // eslint-disable-next-line no-param-reassign
        obs.imageLeft = remap(obs.imageLeft, pair.left);
        // eslint-disable-next-line no-param-reassign
        obs.imageRight = remap(obs.imageRight, pair.right);
      });
    });
  }
  return importCameraRegistrationData(settings, datasetId, data, npath.basename(filePath));
}
