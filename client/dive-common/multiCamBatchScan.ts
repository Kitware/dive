/**
 * Batch multicam ("multi-collect") import scan logic shared by desktop and web.
 *
 * Scans a root folder whose immediate children are "collect" folders; each collect
 * folder is expected to hold the same set of camera subfolders (e.g. EO/, IR/, UV/),
 * each containing that camera's image frames.
 *
 * Flat multi-modality view folders (images for 1-3 modalities in one folder,
 * split by *_rgb / *_ir / *_uv filename suffixes) are also recognized as
 * collects: each modality becomes a camera selected by a filename glob (see
 * viewFolderFormat.ts).
 */
import { MultiCamImportFolderArgs } from 'dive-common/apispec';
import {
  isValidCameraName,
  orderSubfolderCameraNames,
  pickDefaultMulticamCamera,
} from 'dive-common/components/ImportMultiCamDialog/multicamSubfolderLayout';
import { assignRegistrationFilesToCameras } from 'dive-common/registrationParentFolder';
import {
  detectFolderModalities,
  groupByModality,
  Modalities,
  Modality,
  modalityGlob,
} from 'dive-common/viewFolderFormat';

/** Camera-count limits shared with the single multicam subfolder import. */
export const MinBatchCameras = 2;
export const MaxBatchCameras = 3;

/** One camera subfolder discovered inside a collect folder during a batch scan. */
export interface MultiCamBatchCamera {
  name: string;
  sourcePath: string;
  imageCount: number;
  /** Filename glob when cameras share the collect folder (per-modality suffixes). */
  glob?: string;
}

/** Scan result for a single collect folder (one multicam dataset candidate). */
export interface MultiCamBatchCollect {
  name: string;
  path: string;
  cameras: MultiCamBatchCamera[];
  /** File names of the collect's registration files attached to importArgs. */
  transformFiles: string[];
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
  /**
   * Qualified DIVE registration .json files found in the collect folder root
   * (platform-discovered, in attachment priority order); assigned to camera
   * slots on the collect's importArgs.
   */
  transformFiles?: string[];
  /** Image file names directly in the collect folder (flat multi-modality view folders). */
  rootImageNames?: string[];
}

/**
 * Modalities of a flat view-folder collect: no image-bearing camera
 * subfolders, and the collect folder's own images all carry a modality suffix
 * and a filename timestamp.
 */
function collectViewFolderModalities(collect: CollectRawScan): Modality[] {
  const hasImageSubfolder = [...collect.subfolders.values()]
    .some((subfolder) => subfolder.imageCount > 0);
  if (hasImageSubfolder) {
    return [];
  }
  return detectFolderModalities(collect.rootImageNames ?? []);
}

function buildViewFolderCollectResult(
  collect: CollectRawScan,
  modalities: Modality[],
  rootLabel: string,
): MultiCamBatchCollect {
  const grouped = groupByModality(collect.rootImageNames ?? []);
  const cameras: MultiCamBatchCamera[] = modalities.map((modality) => ({
    name: modality,
    sourcePath: collect.path,
    imageCount: grouped.get(modality)?.length ?? 0,
    glob: modalityGlob(modality),
  }));

  const warnings: string[] = [];
  if (modalities.length === 1) {
    warnings.push(
      `Only one modality (${modalities[0]}) found; the dataset will have a single camera`,
    );
  }

  const sourceList: MultiCamImportFolderArgs['sourceList'] = {};
  cameras.forEach((camera) => {
    sourceList[camera.name] = {
      sourcePath: camera.sourcePath,
      trackFile: '',
      glob: camera.glob,
    };
  });

  const transformFiles: string[] = [];
  if (collect.transformFiles?.length) {
    const { assignments, unassigned } = assignRegistrationFilesToCameras(
      collect.transformFiles,
      modalities,
    );
    assignments.forEach(({ camera, filePath }) => {
      sourceList[camera].transformFile = filePath;
      transformFiles.push(filePath.replace(/^.*[\\/]/, ''));
    });
    if (unassigned.length) {
      warnings.push(
        `Registration file(s) not attached (no free camera slot): ${unassigned
          .map((filePath) => filePath.replace(/^.*[\\/]/, ''))
          .join(', ')}`,
      );
    }
  }

  return {
    name: collect.name,
    path: collect.path,
    cameras,
    transformFiles,
    problems: [],
    warnings,
    importArgs: {
      // A bare view name (left_view) is ambiguous across collections; prefix the root folder
      datasetName: rootLabel ? `${rootLabel}_${collect.name}` : collect.name,
      defaultDisplay: modalities[0],
      cameraOrder: [...modalities],
      sourceList,
      type: 'image-sequence',
    },
  };
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
  const transformFiles: string[] = [];
  if (!problems.length) {
    const sourceList: MultiCamImportFolderArgs['sourceList'] = {};
    cameras.forEach((camera) => {
      sourceList[camera.name] = { sourcePath: camera.sourcePath, trackFile: '' };
    });
    if (collect.transformFiles?.length) {
      const { assignments, unassigned } = assignRegistrationFilesToCameras(
        collect.transformFiles,
        cameraNames,
      );
      assignments.forEach(({ camera, filePath }) => {
        sourceList[camera].transformFile = filePath;
        transformFiles.push(filePath.replace(/^.*[\\/]/, ''));
      });
      if (unassigned.length) {
        warnings.push(
          `Registration file(s) not attached (no free camera slot): ${unassigned
            .map((filePath) => filePath.replace(/^.*[\\/]/, ''))
            .join(', ')}`,
        );
      }
    }
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
    transformFiles,
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

  // Flat view-folder collects are self-describing (cameras = modalities
  // present); the shared camera-set rules below apply only to subfolder-based
  // collects.
  const viewModalitiesByCollect = new Map<string, Modality[]>();
  rawScans.forEach((collect) => {
    const modalities = collectViewFolderModalities(collect);
    if (modalities.length) {
      viewModalitiesByCollect.set(collect.name, modalities);
    }
  });
  const subfolderScans = rawScans.filter(
    (collect) => !viewModalitiesByCollect.has(collect.name),
  );

  const canonicalNames = canonicalCameraNames(subfolderScans);
  if (subfolderScans.length) {
    problems.push(...validateCameraSet(canonicalNames));
  }

  const modalityUnion = Modalities.filter(
    (modality) => [...viewModalitiesByCollect.values()]
      .some((modalities) => modalities.includes(modality)),
  );
  const cameraNames = [
    ...canonicalNames,
    ...modalityUnion.filter((modality) => !canonicalNames.includes(modality)),
  ];

  const rootLabel = rootPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  const cameraSetValid = !problems.length;
  const collects = rawScans.map((collect) => {
    const modalities = viewModalitiesByCollect.get(collect.name);
    if (modalities) {
      return buildViewFolderCollectResult(collect, modalities, rootLabel);
    }
    const result = buildCollectResult(collect, canonicalNames);
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
