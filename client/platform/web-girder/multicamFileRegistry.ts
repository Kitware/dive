/** Stash browser File selections for multicam import (paths are not filesystem paths on web). */

import { openFromDisk } from './utils';

const LAST_CALIBRATION_STORAGE_KEY = 'dive_web_last_calibration';

const filesByKey = new Map<string, File[]>();
const annotationFilesByKey = new Map<string, File>();
const calibrationFilesByKey = new Map<string, File>();

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

export function stashCalibrationFile(key: string, file: File): void {
  calibrationFilesByKey.set(key, file);
}

export function getCalibrationFile(key: string): File | undefined {
  return calibrationFilesByKey.get(key);
}

export function clearMulticamFileRegistry(): void {
  filesByKey.clear();
  annotationFilesByKey.clear();
  calibrationFilesByKey.clear();
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
    } else {
      stashFileSelection(ret);
    }
  }
  return ret;
}

export function getLastCalibration(): Promise<string | null> {
  return Promise.resolve(localStorage.getItem(LAST_CALIBRATION_STORAGE_KEY));
}

export function saveCalibration(path: string): Promise<{ savedPath: string; updatedDatasetIds: string[] }> {
  localStorage.setItem(LAST_CALIBRATION_STORAGE_KEY, path);
  return Promise.resolve({ savedPath: path, updatedDatasetIds: [] });
}
