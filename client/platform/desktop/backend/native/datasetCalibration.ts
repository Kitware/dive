/**
 * Stereo camera-rig calibration management for the desktop backend.
 *
 * Handles per-dataset calibration files, the global "last used" backup, and
 * parent-folder discovery during multicam import. Normalization to the VIAME
 * JSON camera-rig format lives in calibrationConvert.ts.
 */

import npath from 'path';
import fs from 'fs-extra';

import { DatasetCalibrationResult } from 'dive-common/apispec';
import { pickStereoCalibrationFileName } from 'dive-common/stereoParentFolder';
import parseStereoCalibrationJson from 'dive-common/utils/parseStereoCalibrationJson';
import { JsonMeta, Settings, LastCalibrationBaseName } from 'platform/desktop/constants';

import { prepareDatasetCalibration } from './calibrationConvert';
// eslint-disable-next-line import/no-cycle
import { autodiscoverData, getValidatedProjectDir, loadJsonMetadata } from './common';

async function writeJsonFile(absPath: string, data: unknown): Promise<void> {
  await fs.writeFile(absPath, JSON.stringify(data, null, 2));
}

/**
 * The user's calibration filename, unless it is DIVE's internal
 * `last_calibration.*` backup (which carries no meaningful original name).
 */
export function realCalibrationName(name?: string | null): string | undefined {
  if (!name) return undefined;
  const base = npath.basename(name);
  if (base.toLowerCase().startsWith(`${LastCalibrationBaseName}.`)) return undefined;
  return base;
}

/**
 * Find a stereoscopic calibration file (.json or .npz with cal/calibration in the name)
 * in the parent folder root.
 */
export async function findParentFolderCalibrationFile(parentPath: string): Promise<string | null> {
  if (!await fs.pathExists(parentPath)) {
    return null;
  }
  const stat = await fs.stat(parentPath);
  if (!stat.isDirectory()) {
    return null;
  }
  const children = await fs.readdir(parentPath, { withFileTypes: true });
  const fileNames = children.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const bestName = pickStereoCalibrationFileName(fileNames);
  if (!bestName) {
    return null;
  }
  return npath.join(parentPath, bestName);
}

/**
 * Get path to the saved "last used" calibration (last_calibration.*) if it
 * exists. The stored file keeps the source's real extension, so we match on the
 * basename rather than a fixed filename.
 * @returns path to last calibration file or null if it doesn't exist
 */
export async function getLastCalibrationPath(settings: Settings): Promise<string | null> {
  if (!(await fs.pathExists(settings.dataPath))) return null;
  const entries = await fs.readdir(settings.dataPath);
  const match = entries.find(
    (f) => npath.basename(f, npath.extname(f)) === LastCalibrationBaseName,
  );
  return match ? npath.join(settings.dataPath, match) : null;
}

/**
 * Save a calibration file as the last used calibration, preserving the source
 * file's extension (e.g. last_calibration.npz) so its real format is retained.
 * @param settings app settings
 * @param sourcePath path to the source calibration file
 * @returns path to the saved calibration file
 */
export async function saveLastCalibration(settings: Settings, sourcePath: string): Promise<string> {
  const ext = npath.extname(sourcePath) || '.json';
  // Remove any prior backup with a different extension to avoid stale duplicates.
  if (await fs.pathExists(settings.dataPath)) {
    const entries = await fs.readdir(settings.dataPath);
    await Promise.all(entries
      .filter((f) => npath.basename(f, npath.extname(f)) === LastCalibrationBaseName)
      .map((f) => fs.remove(npath.join(settings.dataPath, f))));
  }
  const destPath = npath.join(settings.dataPath, `${LastCalibrationBaseName}${ext}`);
  await fs.copy(sourcePath, destPath, { overwrite: true });
  return destPath;
}

/**
 * Apply calibration to all stereo datasets that don't already have calibration set.
 * The source is copied into each dataset and normalized to JSON, and the user's
 * original filename is recorded for display.
 * @param settings app settings
 * @param calibrationPath path to the calibration file to apply
 * @param originalName user's original calibration filename (for display)
 * @returns list of dataset IDs that were updated
 */
export async function applyCalibrationToUncalibratedStereoDatasets(
  settings: Settings,
  calibrationPath: string,
  originalName?: string,
): Promise<string[]> {
  const datasets = await autodiscoverData(settings);
  const updatedIds: string[] = [];

  for (let i = 0; i < datasets.length; i += 1) {
    const meta = datasets[i];
    // Check if this is a stereo dataset without calibration
    if (meta.subType === 'stereo' && meta.multiCam && !meta.multiCam.calibration) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const projectDirInfo = await getValidatedProjectDir(settings, meta.id);
        // eslint-disable-next-line no-await-in-loop
        const fullMeta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
        if (fullMeta.multiCam) {
          const calibrationSourcePath = npath.resolve(calibrationPath);
          const preservedOriginalPath = npath.join(
            projectDirInfo.basePath,
            npath.basename(calibrationSourcePath),
          );
          // eslint-disable-next-line no-await-in-loop
          fullMeta.multiCam.calibration = await prepareDatasetCalibration(
            settings,
            projectDirInfo.basePath,
            calibrationSourcePath,
          );
          fullMeta.multiCam.calibrationSourcePath = preservedOriginalPath;
          fullMeta.multiCam.calibrationOriginalName = realCalibrationName(originalName)
            ?? realCalibrationName(calibrationSourcePath);
          // eslint-disable-next-line no-await-in-loop
          await writeJsonFile(projectDirInfo.metaFileAbsPath, fullMeta);
          updatedIds.push(meta.id);
        }
      } catch (err) {
        // Skip datasets that fail to update
        console.error(`Failed to update calibration for dataset ${meta.id}:`, err);
      }
    }
  }

  return updatedIds;
}

/**
 * True when a dataset has a stereoscopic calibration file on disk.
 */
export async function datasetHasCalibrationFile(settings: Settings, datasetId: string): Promise<boolean> {
  const parentId = datasetId.split('/')[0];
  try {
    const projectDirData = await getValidatedProjectDir(settings, parentId);
    const meta = await loadJsonMetadata(projectDirData.metaFileAbsPath);
    if (meta.multiCam?.calibration && await fs.pathExists(meta.multiCam.calibration)) {
      return true;
    }
    const discovered = await findParentFolderCalibrationFile(projectDirData.basePath);
    return discovered !== null;
  } catch {
    return false;
  }
}

/**
 * Get the JSON camera-rig path used for pipelines and calibration display.
 */
export async function getDatasetCalibrationPath(
  settings: Settings,
  datasetId: string,
): Promise<string | null> {
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  const fullMeta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  return fullMeta.multiCam?.calibration ?? null;
}

/**
 * Resolve the user's original calibration file for export (not the derived JSON).
 */
export async function getDatasetCalibrationExportPath(
  settings: Settings,
  datasetId: string,
): Promise<string | null> {
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId);
  const fullMeta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  const { multiCam } = fullMeta;
  if (!multiCam) {
    return null;
  }

  const originalName = multiCam.calibrationOriginalName;
  if (originalName) {
    const projectCopy = npath.join(projectDirInfo.basePath, originalName);
    if (await fs.pathExists(projectCopy)) {
      return projectCopy;
    }
  }
  if (multiCam.calibrationSourcePath && await fs.pathExists(multiCam.calibrationSourcePath)) {
    return multiCam.calibrationSourcePath;
  }
  const calibrationPath = multiCam.calibration;
  if (calibrationPath && await fs.pathExists(calibrationPath)) {
    return calibrationPath;
  }
  return null;
}

/**
 * Set the stereo camera/calibration file for a single dataset. The source file is
 * copied into the dataset's project directory and recorded in multiCam.calibration.
 * @returns absolute path of the calibration file now associated with the dataset
 */
export async function setDatasetCalibration(
  settings: Settings,
  datasetId: string,
  sourcePath: string,
): Promise<string> {
  // A calibration belongs to the parent multicam dataset; the viewer may pass a
  // per-camera child id (e.g. "<parent>/left").
  const parentId = datasetId.split('/')[0];
  const projectDirInfo = await getValidatedProjectDir(settings, parentId);
  const fullMeta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  if (!fullMeta.multiCam) {
    throw new Error(`Dataset ${parentId} is not a multi-camera/stereo dataset; cannot set a calibration file.`);
  }
  const preservedOriginalPath = npath.join(
    projectDirInfo.basePath,
    npath.basename(sourcePath),
  );
  const calibrationPath = await prepareDatasetCalibration(
    settings,
    projectDirInfo.basePath,
    sourcePath,
  );
  fullMeta.multiCam.calibration = calibrationPath;
  fullMeta.multiCam.calibrationSourcePath = npath.resolve(preservedOriginalPath);
  fullMeta.multiCam.calibrationOriginalName = realCalibrationName(sourcePath);
  await writeJsonFile(projectDirInfo.metaFileAbsPath, fullMeta);
  return calibrationPath;
}

/**
 * Copy a dataset's current camera/calibration file out to destPath.
 * @returns the destination path written
 */
export async function exportDatasetCalibration(
  settings: Settings,
  datasetId: string,
  destPath: string,
): Promise<string> {
  const calibrationPath = await getDatasetCalibrationExportPath(settings, datasetId.split('/')[0]);
  if (!calibrationPath) {
    throw new Error(`Dataset ${datasetId} has no camera/calibration file to export.`);
  }
  if (!(await fs.pathExists(calibrationPath))) {
    throw new Error(`Calibration file for dataset ${datasetId} no longer exists on disk: ${calibrationPath}`);
  }
  await fs.copy(calibrationPath, destPath, { overwrite: true });
  return destPath;
}

/**
 * Read the calibration file currently associated with a dataset and return its
 * parsed parameters (when JSON) plus the file name, for display in the viewer.
 */
export async function getDatasetCalibration(
  settings: Settings,
  datasetId: string,
): Promise<DatasetCalibrationResult | null> {
  const projectDirInfo = await getValidatedProjectDir(settings, datasetId.split('/')[0]);
  const fullMeta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  const calibrationPath = fullMeta.multiCam?.calibration;
  if (!calibrationPath || !(await fs.pathExists(calibrationPath))) {
    return null;
  }
  const result: DatasetCalibrationResult = {
    path: npath.basename(calibrationPath),
    originalName: realCalibrationName(fullMeta.multiCam?.calibrationOriginalName),
  };
  if (npath.extname(calibrationPath).toLowerCase() === '.json') {
    try {
      const data = await fs.readJSON(calibrationPath);
      result.calibration = parseStereoCalibrationJson(data);
    } catch (err) {
      console.error(`Failed to parse calibration JSON for dataset ${datasetId}:`, err);
    }
  }
  return result;
}

/**
 * Remove the calibration file associated with a dataset and clear the reference
 * in its metadata. The original (pre-conversion) file, if any, is left in place.
 */
export async function deleteDatasetCalibration(settings: Settings, datasetId: string): Promise<void> {
  const parentId = datasetId.split('/')[0];
  const projectDirInfo = await getValidatedProjectDir(settings, parentId);
  const fullMeta = await loadJsonMetadata(projectDirInfo.metaFileAbsPath);
  const calibrationPath = fullMeta.multiCam?.calibration;
  if (calibrationPath && await fs.pathExists(calibrationPath)) {
    await fs.remove(calibrationPath);
  }
  if (fullMeta.multiCam) {
    fullMeta.multiCam.calibration = undefined;
    fullMeta.multiCam.calibrationSourcePath = undefined;
    fullMeta.multiCam.calibrationOriginalName = undefined;
    await writeJsonFile(projectDirInfo.metaFileAbsPath, fullMeta);
  }
}
