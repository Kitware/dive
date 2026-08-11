/**
 * Batch stereo import scan logic shared by desktop and web.
 *
 * Unlike the multi camera batch scan this one requires every dataset to resolve
 * to a left and a right camera; anything that does not is reported and skipped.
 * Three layouts are recognized:
 *
 *  1. A collect folder holding camera subfolders (or videos) whose names carry
 *     l / left / r / right markers, including the plain `left` + `right` case.
 *  2. A collect folder holding exactly two camera subfolders (or two videos)
 *     with names that say nothing about sides; listing order decides.
 *  3. Sibling folders or videos in the root whose names differ only by an L/R
 *     marker (`dive01_left.mp4` + `dive01_right.mp4`); each pair is a dataset.
 */
import { MultiCamImportFolderArgs } from 'dive-common/apispec';
import {
  CollectSubfolderScan,
  MultiCamBatchCamera,
  MultiCamBatchCollect,
  MultiCamBatchScanResult,
} from 'dive-common/multiCamBatchScan';
import { pairStereoNames } from 'dive-common/stereoPairing';

/** Camera names a stereo dataset must use for the importer to mark it stereo. */
export const StereoCameraNames = ['left', 'right'] as const;

/** A video file discovered during a stereo batch scan. */
export interface StereoVideoScan {
  name: string;
  path: string;
}

/** One immediate child folder of the scan root. */
export interface StereoCollectRawScan {
  name: string;
  path: string;
  /** Immediate camera subfolders, keyed by lower-cased folder name. */
  subfolders: Map<string, CollectSubfolderScan>;
  /** Video files sitting directly in this folder. */
  videoFiles?: StereoVideoScan[];
  /** Images sitting directly in this folder (makes it a camera, not a collect). */
  imageCount?: number;
  /** Stereo calibration file found in this folder. */
  calibrationFile?: string | null;
}

export interface StereoBatchRawScan {
  rootPath: string;
  collects: StereoCollectRawScan[];
  /** Video files sitting directly in the root, for root level L/R pairing. */
  rootVideoFiles?: StereoVideoScan[];
  /** Calibration file in the root, used when a collect has none of its own. */
  rootCalibrationFile?: string | null;
}

interface StereoCameraSource {
  sourcePath: string;
  /** Frame count for image cameras; videos report no count. */
  imageCount?: number;
}

function lastPathSegment(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
}

function buildStereoCollect(options: {
  name: string;
  path: string;
  datasetName: string;
  left: StereoCameraSource;
  right: StereoCameraSource;
  type: 'image-sequence' | 'video';
  calibrationFile?: string | null;
  warnings: string[];
}): MultiCamBatchCollect {
  const {
    name, path, datasetName, left, right, type, calibrationFile, warnings,
  } = options;

  const cameras: MultiCamBatchCamera[] = [
    { name: 'left', sourcePath: left.sourcePath, imageCount: left.imageCount ?? 0 },
    { name: 'right', sourcePath: right.sourcePath, imageCount: right.imageCount ?? 0 },
  ];

  const allWarnings = [...warnings];
  if (type === 'image-sequence'
    && left.imageCount !== undefined && right.imageCount !== undefined
    && left.imageCount !== right.imageCount) {
    allWarnings.push(
      `Frame counts differ across cameras (left: ${left.imageCount}, right: ${right.imageCount})`,
    );
  }
  if (!calibrationFile) {
    allWarnings.push(
      'No stereo calibration file found; import it later to enable measurement',
    );
  }

  const sourceList: MultiCamImportFolderArgs['sourceList'] = {
    left: { sourcePath: left.sourcePath, trackFile: '' },
    right: { sourcePath: right.sourcePath, trackFile: '' },
  };

  return {
    name,
    path,
    cameras,
    transformFiles: [],
    problems: [],
    warnings: allWarnings,
    importArgs: {
      datasetName,
      defaultDisplay: 'left',
      cameraOrder: ['left', 'right'],
      sourceList,
      type,
      ...(calibrationFile ? { calibrationFile } : {}),
    },
  };
}

function blockedCollect(
  name: string,
  path: string,
  problems: string[],
): MultiCamBatchCollect {
  return {
    name,
    path,
    cameras: [],
    transformFiles: [],
    problems,
    warnings: [],
    importArgs: null,
  };
}

/** Resolve one collect folder to a left/right pair using layouts 1 and 2. */
function resolveCollect(
  collect: StereoCollectRawScan,
  rootCalibrationFile: string | null,
): MultiCamBatchCollect {
  const calibrationFile = collect.calibrationFile ?? rootCalibrationFile;
  const imageSubfolders = [...collect.subfolders.values()]
    .filter((subfolder) => subfolder.imageCount > 0)
    .sort((a, b) => a.folderName.localeCompare(b.folderName));
  const videoFiles = [...(collect.videoFiles ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name));

  const toCamera = (subfolder: CollectSubfolderScan): StereoCameraSource => ({
    sourcePath: subfolder.path,
    imageCount: subfolder.imageCount,
  });
  const toVideoCamera = (video: StereoVideoScan): StereoCameraSource => ({
    sourcePath: video.path,
  });

  if (imageSubfolders.length) {
    const { pairs } = pairStereoNames(imageSubfolders, (subfolder) => subfolder.folderName);
    if (pairs.length === 1) {
      return buildStereoCollect({
        name: collect.name,
        path: collect.path,
        datasetName: collect.name,
        left: toCamera(pairs[0].left),
        right: toCamera(pairs[0].right),
        type: 'image-sequence',
        calibrationFile,
        warnings: [],
      });
    }
    if (pairs.length > 1) {
      return blockedCollect(collect.name, collect.path, [
        `Found ${pairs.length} left/right camera folder pairs; expected one stereo pair`,
      ]);
    }
    if (imageSubfolders.length === 2) {
      return buildStereoCollect({
        name: collect.name,
        path: collect.path,
        datasetName: collect.name,
        left: toCamera(imageSubfolders[0]),
        right: toCamera(imageSubfolders[1]),
        type: 'image-sequence',
        calibrationFile,
        warnings: [
          `Camera folder names do not identify sides; "${imageSubfolders[0].folderName}" `
          + `was taken as left and "${imageSubfolders[1].folderName}" as right`,
        ],
      });
    }
    return blockedCollect(collect.name, collect.path, [
      'No left and right camera folders found (looked for l/left and r/right names, '
      + `or exactly two camera folders; found ${imageSubfolders.length}: `
      + `${imageSubfolders.map((subfolder) => subfolder.folderName).join(', ')})`,
    ]);
  }

  if (videoFiles.length) {
    const { pairs } = pairStereoNames(videoFiles, (video) => video.name);
    if (pairs.length === 1) {
      return buildStereoCollect({
        name: collect.name,
        path: collect.path,
        datasetName: collect.name,
        left: toVideoCamera(pairs[0].left),
        right: toVideoCamera(pairs[0].right),
        type: 'video',
        calibrationFile,
        warnings: [],
      });
    }
    if (pairs.length > 1) {
      return blockedCollect(collect.name, collect.path, [
        `Found ${pairs.length} left/right video pairs; expected one stereo pair`,
      ]);
    }
    if (videoFiles.length === 2) {
      return buildStereoCollect({
        name: collect.name,
        path: collect.path,
        datasetName: collect.name,
        left: toVideoCamera(videoFiles[0]),
        right: toVideoCamera(videoFiles[1]),
        type: 'video',
        calibrationFile,
        warnings: [
          `Video names do not identify sides; "${videoFiles[0].name}" was taken as left `
          + `and "${videoFiles[1].name}" as right`,
        ],
      });
    }
    return blockedCollect(collect.name, collect.path, [
      'No left and right videos found (looked for l/left and r/right names, or exactly '
      + `two videos; found ${videoFiles.length}: ${videoFiles.map((v) => v.name).join(', ')})`,
    ]);
  }

  return blockedCollect(collect.name, collect.path, [
    'No camera folders with images and no videos found',
  ]);
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  let suffix = 2;
  while (taken.has(`${name}_${suffix}`)) {
    suffix += 1;
  }
  const unique = `${name}_${suffix}`;
  taken.add(unique);
  return unique;
}

/** Suffix the collect display name and keep importArgs.datasetName in sync. */
function withUniqueName(
  collect: MultiCamBatchCollect,
  taken: Set<string>,
): MultiCamBatchCollect {
  const name = uniqueName(collect.name, taken);
  if (name === collect.name) {
    return collect;
  }
  return {
    ...collect,
    name,
    importArgs: collect.importArgs
      ? { ...collect.importArgs, datasetName: name }
      : null,
  };
}

/**
 * Build a stereo batch scan result from a pre-scanned root folder.
 */
export function scanStereoBatchFromScan(raw: StereoBatchRawScan): MultiCamBatchScanResult {
  const { rootPath } = raw;
  const rootCalibrationFile = raw.rootCalibrationFile ?? null;
  const rootLabel = lastPathSegment(rootPath);
  const problems: string[] = [];
  const collects: MultiCamBatchCollect[] = [];
  const takenNames = new Set<string>();

  // Layout 3, videos: root level video files whose names pair by L/R marker.
  const rootVideos = [...(raw.rootVideoFiles ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const videoPairing = pairStereoNames(rootVideos, (video) => video.name);
  videoPairing.pairs.forEach((pair) => {
    const stem = pair.stem || rootLabel;
    const name = uniqueName(stem, takenNames);
    collects.push(buildStereoCollect({
      name,
      path: rootPath,
      datasetName: name,
      left: { sourcePath: pair.left.path },
      right: { sourcePath: pair.right.path },
      type: 'video',
      calibrationFile: rootCalibrationFile,
      warnings: [],
    }));
  });

  // Layout 3, folders: root level folders that hold images directly and whose
  // names pair by L/R marker. Folders without their own images are collects to
  // descend into instead, even when their names happen to pair.
  const cameraFolders = raw.collects.filter((collect) => (collect.imageCount ?? 0) > 0);
  const folderPairing = pairStereoNames(cameraFolders, (collect) => collect.name);
  const pairedFolders = new Set<StereoCollectRawScan>();
  folderPairing.pairs.forEach((pair) => {
    pairedFolders.add(pair.left);
    pairedFolders.add(pair.right);
    const stem = pair.stem || rootLabel;
    const name = uniqueName(stem, takenNames);
    collects.push(buildStereoCollect({
      name,
      path: rootPath,
      datasetName: name,
      left: {
        sourcePath: pair.left.path,
        imageCount: pair.left.imageCount,
      },
      right: {
        sourcePath: pair.right.path,
        imageCount: pair.right.imageCount,
      },
      type: 'image-sequence',
      calibrationFile: pair.left.calibrationFile ?? rootCalibrationFile,
      warnings: [],
    }));
  });

  // Layouts 1 and 2: everything else is a collect folder holding both cameras.
  raw.collects
    .filter((collect) => !pairedFolders.has(collect))
    .forEach((collect) => {
      const resolved = resolveCollect(collect, rootCalibrationFile);
      collects.push(withUniqueName(resolved, takenNames));
    });

  if (!raw.collects.length && !rootVideos.length) {
    problems.push(`No folders or videos found in ${rootPath}`);
  } else if (!collects.some((collect) => collect.importArgs)) {
    problems.push(
      'No stereo datasets found. Each dataset needs a left and a right camera: name '
      + 'folders or videos with l/left and r/right markers, or leave exactly two '
      + 'camera folders or videos per collect folder.',
    );
  }

  return {
    rootPath,
    cameraNames: [...StereoCameraNames],
    collects,
    problems,
  };
}
