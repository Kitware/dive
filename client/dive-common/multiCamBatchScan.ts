/**
 * Batch multicam ("multi-collect") import scan logic shared by desktop and web.
 *
 * Scans a root folder whose immediate children are "collect" folders; each collect
 * folder is expected to hold the same set of camera subfolders (e.g. EO/, IR/, UV/),
 * each containing that camera's image frames.
 */
import { MultiCamImportFolderArgs } from 'dive-common/apispec';
import {
  isValidCameraName,
  orderSubfolderCameraNames,
  pickDefaultMulticamCamera,
} from 'dive-common/components/ImportMultiCamDialog/multicamSubfolderLayout';

/** Camera-count limits shared with the single multicam subfolder import. */
export const MinBatchCameras = 2;
export const MaxBatchCameras = 3;

/** One camera subfolder discovered inside a collect folder during a batch scan. */
export interface MultiCamBatchCamera {
  name: string;
  sourcePath: string;
  imageCount: number;
}

/** Scan result for a single collect folder (one multicam dataset candidate). */
export interface MultiCamBatchCollect {
  name: string;
  path: string;
  cameras: MultiCamBatchCamera[];
  problems: string[];
  warnings: string[];
  importArgs: MultiCamImportFolderArgs | null;
}

/** Result of scanning a root folder of collect folders for batch multicam import. */
export interface MultiCamBatchScanResult {
  rootPath: string;
  cameraNames: string[];
  collects: MultiCamBatchCollect[];
  problems: string[];
}

export interface CollectSubfolderScan {
  folderName: string;
  path: string;
  entryCount: number;
  imageCount: number;
}

export interface CollectRawScan {
  name: string;
  path: string;
  subfolders: Map<string, CollectSubfolderScan>;
}

function canonicalCameraNames(collects: CollectRawScan[]): string[] {
  const canonical = new Map<string, string>();
  collects.forEach((collect) => {
    collect.subfolders.forEach((subfolder, lowerName) => {
      if (subfolder.imageCount > 0 && !canonical.has(lowerName)) {
        canonical.set(lowerName, subfolder.folderName);
      }
    });
  });
  return orderSubfolderCameraNames([...canonical.values()]);
}

function validateCameraSet(cameraNames: string[]): string[] {
  const problems: string[] = [];
  if (cameraNames.length < MinBatchCameras || cameraNames.length > MaxBatchCameras) {
    problems.push(
      `Expected ${MinBatchCameras} or ${MaxBatchCameras} camera folders shared across collects, `
      + `found ${cameraNames.length}${cameraNames.length ? ` (${cameraNames.join(', ')})` : ''}`,
    );
  }
  const invalid = cameraNames.filter((name) => !isValidCameraName(name));
  if (invalid.length) {
    problems.push(
      `Camera folder names must be letters and numbers only (no spaces): ${invalid.join(', ')}`,
    );
  }
  return problems;
}

function buildCollectResult(
  collect: CollectRawScan,
  cameraNames: string[],
): MultiCamBatchCollect {
  const problems: string[] = [];
  const warnings: string[] = [];
  const cameras: MultiCamBatchCamera[] = [];

  cameraNames.forEach((cameraName) => {
    const subfolder = collect.subfolders.get(cameraName.toLowerCase());
    if (!subfolder) {
      problems.push(`Missing camera folder "${cameraName}"`);
      return;
    }
    if (subfolder.entryCount === 0) {
      problems.push(`Camera folder "${cameraName}" is empty`);
      return;
    }
    if (subfolder.imageCount === 0) {
      problems.push(`No supported images in camera folder "${cameraName}"`);
      return;
    }
    cameras.push({
      name: cameraName,
      sourcePath: subfolder.path,
      imageCount: subfolder.imageCount,
    });
  });

  if (!problems.length && cameras.length > 1) {
    const counts = cameras.map((camera) => camera.imageCount);
    if (new Set(counts).size > 1) {
      warnings.push(
        `Frame counts differ across cameras (${cameras
          .map((camera) => `${camera.name}: ${camera.imageCount}`)
          .join(', ')})`,
      );
    }
  }

  let importArgs: MultiCamImportFolderArgs | null = null;
  if (!problems.length) {
    const sourceList: MultiCamImportFolderArgs['sourceList'] = {};
    cameras.forEach((camera) => {
      sourceList[camera.name] = { sourcePath: camera.sourcePath, trackFile: '' };
    });
    importArgs = {
      datasetName: collect.name,
      defaultDisplay: pickDefaultMulticamCamera(cameraNames),
      cameraOrder: [...cameraNames],
      sourceList,
      type: 'image-sequence',
    };
  }

  return {
    name: collect.name,
    path: collect.path,
    cameras,
    problems,
    warnings,
    importArgs,
  };
}

/**
 * Build a batch scan result from pre-scanned collect folders.
 */
export function scanMultiCamBatchFromCollects(
  rootPath: string,
  rawScans: CollectRawScan[],
): MultiCamBatchScanResult {
  const problems: string[] = [];
  if (!rawScans.length) {
    problems.push(`No collect folders found in ${rootPath}`);
  }

  const cameraNames = canonicalCameraNames(rawScans);
  if (rawScans.length) {
    problems.push(...validateCameraSet(cameraNames));
  }

  const cameraSetValid = !problems.length;
  const collects = rawScans.map((collect) => {
    const result = buildCollectResult(collect, cameraNames);
    if (!cameraSetValid) {
      return { ...result, importArgs: null };
    }
    return result;
  });

  return {
    rootPath,
    cameraNames,
    collects,
    problems,
  };
}
