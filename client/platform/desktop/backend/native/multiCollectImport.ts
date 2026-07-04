/**
 * Batch multicam ("multi-collect") import scanner.
 *
 * Scans a root folder whose immediate children are "collect" folders; each collect
 * folder is expected to hold the same set of camera subfolders (e.g. EO/, IR/, UV/),
 * each containing that camera's image frames. Produces one ready-to-run
 * `beginMultiCamImport` argument set per valid collect, without copying any imagery
 * (the existing multicam import records `originalBasePath` in place).
 *
 * Validation rules:
 * - Camera subfolders are matched case-insensitively across collects; the canonical
 *   camera set is the union of subfolder names that contain at least one supported
 *   image in at least one collect. Subfolders that never contain images anywhere
 *   (and loose files at the collect level) are ignored as non-camera content.
 * - The canonical camera set must contain 2 or 3 alphanumeric camera names, matching
 *   the limits of the existing multicam subfolder import (multicamSubfolderLayout).
 * - Per collect, a canonical camera must exist and contain at least one supported
 *   image; otherwise the collect is flagged with a blocking problem.
 * - Differing frame counts between cameras within a collect are reported as a
 *   non-blocking warning (seal collects legitimately drop frames on some cameras).
 * - `defaultDisplay` follows the existing convention (`pickDefaultMulticamCamera`):
 *   a camera named "center"/"middle" when present, otherwise the middle camera of
 *   the display order (for 2 cameras, the first).
 */
import npath from 'path';
import fs from 'fs-extra';
import { MultiCamImportFolderArgs } from 'dive-common/apispec';
import {
  isValidCameraName,
  orderSubfolderCameraNames,
  pickDefaultMulticamCamera,
} from 'dive-common/components/ImportMultiCamDialog/multicamSubfolderLayout';
import {
  MultiCamBatchCamera,
  MultiCamBatchCollect,
  MultiCamBatchScanResult,
} from 'platform/desktop/constants';
import { findImagesInFolder, listImmediateSubfolders } from './common';

/** Camera-count limits shared with the single multicam subfolder import. */
export const MinBatchCameras = 2;
export const MaxBatchCameras = 3;

interface CollectSubfolderScan {
  // subfolder name as found on disk
  folderName: string;
  // absolute path of the subfolder
  path: string;
  // total directory entries (0 means completely empty folder)
  entryCount: number;
  // supported images found by the standard multicam image filter
  imageCount: number;
}

interface CollectRawScan {
  name: string;
  path: string;
  // keyed by lowercased subfolder name
  subfolders: Map<string, CollectSubfolderScan>;
}

async function scanCollectFolder(collectPath: string): Promise<Map<string, CollectSubfolderScan>> {
  const subfolderNames = await listImmediateSubfolders(collectPath);
  const subfolders = new Map<string, CollectSubfolderScan>();
  // Sequential on purpose: keeps disk access predictable for large surveys.
  for (let i = 0; i < subfolderNames.length; i += 1) {
    const folderName = subfolderNames[i];
    const subfolderPath = npath.join(collectPath, folderName);
    // eslint-disable-next-line no-await-in-loop
    const entryCount = (await fs.readdir(subfolderPath)).length;
    // eslint-disable-next-line no-await-in-loop
    const found = await findImagesInFolder(subfolderPath);
    subfolders.set(folderName.toLowerCase(), {
      folderName,
      path: subfolderPath,
      entryCount,
      imageCount: found.imagePaths.length,
    });
  }
  return subfolders;
}

/**
 * Determine the canonical camera set: subfolder names holding at least one supported
 * image in at least one collect. Names are matched case-insensitively; the casing of
 * the first collect that has images for a camera wins.
 */
function canonicalCameraNames(collects: CollectRawScan[]): string[] {
  const canonical = new Map<string, string>(); // lowercased -> display casing
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
 * Scan a root folder of collect folders and produce per-collect multicam import
 * arguments compatible with `beginMultiCamImport`.
 */
async function scanMultiCamBatch(rootPath: string): Promise<MultiCamBatchScanResult> {
  const collectNames = (await listImmediateSubfolders(rootPath))
    .sort((a, b) => a.localeCompare(b));

  const rawScans: CollectRawScan[] = [];
  for (let i = 0; i < collectNames.length; i += 1) {
    const name = collectNames[i];
    const collectPath = npath.join(rootPath, name);
    rawScans.push({
      name,
      path: collectPath,
      // eslint-disable-next-line no-await-in-loop
      subfolders: await scanCollectFolder(collectPath),
    });
  }

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
      // A structurally-invalid camera set blocks every collect.
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

export default scanMultiCamBatch;
