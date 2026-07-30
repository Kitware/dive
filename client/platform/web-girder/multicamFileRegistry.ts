/** Stash browser File selections for multicam import (paths are not filesystem paths on web). */

import { Location } from '@girder/components/src';
import { parentDatasetId } from 'dive-common/compositeDatasetId';
import { openFromDisk, GirderUploadManager } from './utils';

const LAST_CALIBRATION_STORAGE_KEY = 'dive_web_last_calibration';

const filesByKey = new Map<string, File[]>();
const annotationFilesByKey = new Map<string, File>();
const calibrationFilesByKey = new Map<string, File>();
const transformFilesByKey = new Map<string, File>();
const metadataFilesByKey = new Map<string, File>();

function commonDirectoryRoot(paths: string[]): string {
  if (!paths.length) {
    return '';
  }
  const splitPaths = paths.map((p) => p.split('/').filter(Boolean));
  if (splitPaths.some((parts) => parts.length <= 1)) {
    return paths[0].includes('/') ? paths[0].split('/').slice(0, -1).join('/') : '';
  }
  const prefix: string[] = [];
  const depth = Math.min(...splitPaths.map((parts) => parts.length - 1));
  for (let i = 0; i < depth; i += 1) {
    const segment = splitPaths[0][i];
    if (splitPaths.every((parts) => parts[i] === segment)) {
      prefix.push(segment);
    } else {
      break;
    }
  }
  return prefix.join('/');
}

export function stashFileSelection(ret: {
  filePaths: string[];
  fileList?: File[];
  root?: string;
}): void {
  if (!ret.fileList?.length) {
    return;
  }
  const keys = new Set<string>();
  if (ret.root) {
    keys.add(ret.root);
  }
  keys.add(ret.filePaths[0]);
  const root = ret.root ?? commonDirectoryRoot(
    ret.fileList.map((f) => f.webkitRelativePath || f.name),
  );
  if (root) {
    keys.add(root);
  }
  keys.forEach((key) => {
    if (key) {
      filesByKey.set(key, ret.fileList as File[]);
    }
  });
}

export function getFilesForSourceKey(sourcePath: string): File[] | undefined {
  return filesByKey.get(sourcePath);
}

export function stashCameraFolderFiles(sourcePath: string, files: File[]): void {
  filesByKey.set(sourcePath, flattenUploadFiles(files));
}

export function removeCameraFolderFiles(sourcePath: string): void {
  filesByKey.delete(sourcePath);
}

export function renameCameraFolderFiles(oldSourcePath: string, newSourcePath: string): void {
  const files = filesByKey.get(oldSourcePath);
  if (files) {
    filesByKey.delete(oldSourcePath);
    filesByKey.set(newSourcePath, files);
  }
}

/** Strip webkitRelativePath so Girder items are created flat in each camera folder. */
export function flattenUploadFiles(files: File[]): File[] {
  return files.map((file) => {
    if (!file.webkitRelativePath || file.webkitRelativePath === file.name) {
      return file;
    }
    return new File([file], file.name, { type: file.type, lastModified: file.lastModified });
  });
}

export function mediaFileNamesForImport(files: File[]): string[] {
  return flattenUploadFiles(files).map((file) => file.name);
}

export function stashAnnotationFile(key: string, file: File): void {
  annotationFilesByKey.set(key, file);
}

export function getAnnotationFile(key: string): File | undefined {
  return annotationFilesByKey.get(key);
}

function calibrationLookupKeys(key: string): string[] {
  const keys = new Set<string>();
  if (key) {
    keys.add(key);
    const base = key.split(/[/\\]/).pop();
    if (base) {
      keys.add(base);
    }
  }
  return [...keys];
}

export function stashCalibrationFile(key: string, file: File): void {
  calibrationLookupKeys(key).forEach((lookupKey) => {
    calibrationFilesByKey.set(lookupKey, file);
  });
  calibrationFilesByKey.set(file.name, file);
}

/** Stash a per-camera registration transform File for multicam import lookup. */
export function stashTransformFile(key: string, file: File): void {
  calibrationLookupKeys(key).forEach((lookupKey) => {
    transformFilesByKey.set(lookupKey, file);
  });
  transformFilesByKey.set(file.name, file);
}

export function getTransformFile(key: string): File | undefined {
  if (!key) {
    return undefined;
  }
  return calibrationLookupKeys(key)
    .map((lookupKey) => transformFilesByKey.get(lookupKey))
    .find((file) => file !== undefined);
}

export function getCalibrationFile(key: string): File | undefined {
  if (!key) {
    return undefined;
  }
  const lookupMatch = calibrationLookupKeys(key)
    .map((lookupKey) => calibrationFilesByKey.get(lookupKey))
    .find((file) => file !== undefined);
  if (lookupMatch) {
    return lookupMatch;
  }
  return [...calibrationFilesByKey.values()].find((file) => file.name === key);
}

/** Stash the chosen per-dataset metadata File for later upload lookup by path or name. */
export function stashMetadataFile(key: string, file: File): void {
  calibrationLookupKeys(key).forEach((lookupKey) => {
    metadataFilesByKey.set(lookupKey, file);
  });
  metadataFilesByKey.set(file.name, file);
}

export function getMetadataFile(key: string): File | undefined {
  if (!key) {
    return undefined;
  }
  const lookupMatch = calibrationLookupKeys(key)
    .map((lookupKey) => metadataFilesByKey.get(lookupKey))
    .find((file) => file !== undefined);
  if (lookupMatch) {
    return lookupMatch;
  }
  return [...metadataFilesByKey.values()].find((file) => file.name === key);
}

export function clearMulticamFileRegistry(): void {
  filesByKey.clear();
  annotationFilesByKey.clear();
  calibrationFilesByKey.clear();
  transformFilesByKey.clear();
  metadataFilesByKey.clear();
}

export async function openFromDiskWithRegistry(
  datasetType: Parameters<typeof openFromDisk>[0],
  directory?: boolean,
) {
  const ret = await openFromDisk(datasetType, directory);
  if (!ret.canceled && ret.fileList?.length) {
    if (datasetType === 'annotation') {
      stashAnnotationFile(ret.filePaths[0], ret.fileList[0]);
    } else if (datasetType === 'calibration') {
      stashCalibrationFile(ret.filePaths[0], ret.fileList[0]);
    } else if (datasetType === 'transform') {
      stashTransformFile(ret.filePaths[0], ret.fileList[0]);
    } else if (datasetType === 'metadata') {
      stashMetadataFile(ret.filePaths[0], ret.fileList[0]);
    } else {
      stashFileSelection(ret);
    }
  }
  return ret;
}

export function getLastCalibration(): Promise<string | null> {
  const stored = localStorage.getItem(LAST_CALIBRATION_STORAGE_KEY);
  if (!stored) {
    return Promise.resolve(null);
  }
  // Browser sessions cannot restore File objects from localStorage; only prefill when
  // the user already chose a calibration file in this session.
  if (getCalibrationFile(stored)) {
    return Promise.resolve(stored);
  }
  return Promise.resolve(null);
}

export function saveCalibration(path: string): Promise<{ savedPath: string; updatedDatasetIds: string[] }> {
  const savedPath = path.split(/[/\\]/).pop() || path;
  localStorage.setItem(LAST_CALIBRATION_STORAGE_KEY, savedPath);
  return Promise.resolve({ savedPath, updatedDatasetIds: [] });
}

/**
 * Upload a calibration file (previously chosen via openFromDiskWithRegistry, so its
 * File is stashed under `fileName`) into the dataset's Girder folder and mark it as
 * the dataset's stereoscopic calibration.
 */
export async function importCalibrationFile(
  datasetId: string,
  fileName: string,
): Promise<{ calibration: string }> {
  const file = getCalibrationFile(fileName);
  if (!file) {
    throw new Error(`Calibration file "${fileName}" is no longer available; please re-select it.`);
  }
  const parentFolderId = parentDatasetId(datasetId);
  // Import the Girder REST client lazily: its module touches `window` at load time,
  // so a top-level import breaks node-environment unit tests that import this module.
  const { default: girderRest } = await import('platform/web-girder/plugins/girder');
  const manager = new GirderUploadManager(file, {
    $rest: girderRest,
    parent: { _id: parentFolderId, _modelType: 'folder' } as Location,
  });
  const uploaded = await manager.start() as { _id: string };
  await girderRest.post(`dive_dataset/${parentFolderId}/calibration`, null, {
    params: { fileId: uploaded._id },
  });
  localStorage.setItem(LAST_CALIBRATION_STORAGE_KEY, file.name);
  return { calibration: file.name };
}
