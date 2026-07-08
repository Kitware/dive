import { fileVideoTypes } from 'dive-common/constants';

/** Assign immediate child folders to multicam cameras (one camera per subfolder). */

export interface SubfolderCameraAssignment {
  /** Camera name (initially the subfolder name). */
  cameraName: string;
  /** Original folder name from disk. */
  folderName: string;
  /** Key for file registry / importMedia (the subfolder name on disk). */
  sourcePath: string;
}

export interface OrganizeSubfolderCamerasResult {
  assignments: SubfolderCameraAssignment[];
  layoutLabel: string;
  defaultDisplay: string;
  error: string | null;
}

/** Same rules as manual "Add Camera" in ImportMultiCamDialog/ImportMultiCamAddType. */
export const CAMERA_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/** Image extensions accepted for parent-folder subfolder discovery (aligned with desktop import). */
export const fileImageTypes = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'tif',
  'tiff',
  'bmp',
  'sgi',
  'pgm',
  'avif',
];

/** Preferred camera order when subfolders use these names (case-insensitive). */
export const PREFERRED_SUBFOLDER_ORDER = ['STAR', 'CENTER', 'PORT'] as const;

/** Camera names that should be the default display when present (case-insensitive). */
export const DEFAULT_DISPLAY_NAME_ALIASES = ['center', 'middle'] as const;

export function isTiffFileName(fileName: string): boolean {
  const parts = fileName.split('.');
  if (parts.length < 2) {
    return false;
  }
  const ext = parts.pop()?.toLowerCase() ?? '';
  return ext === 'tif' || ext === 'tiff';
}

/** True when the subfolder/camera name denotes an electro-optical (EO) sensor. */
export function isEoSubfolderName(name: string): boolean {
  return /(^|_)EO(_|$)/i.test(name);
}

/** True when the subfolder/camera name denotes an infrared (IR) sensor. */
export function isIrSubfolderName(name: string): boolean {
  return /(^|_)IR(_|$)/i.test(name);
}

/** Move EO-named folders to the front and IR-named folders to the back; preserve middle order. */
export function preferEoIrSubfolderOrder(names: string[]): string[] {
  const eo: string[] = [];
  const middle: string[] = [];
  const ir: string[] = [];
  names.forEach((name) => {
    if (isEoSubfolderName(name)) {
      eo.push(name);
    } else if (isIrSubfolderName(name)) {
      ir.push(name);
    } else {
      middle.push(name);
    }
  });
  return [...eo, ...middle, ...ir];
}

/** @deprecated Use preferEoIrSubfolderOrder */
export function preferEoSubfolderFirst(names: string[]): string[] {
  return preferEoIrSubfolderOrder(names);
}

/**
 * Infer import type for one camera subfolder. On web, all-TIFF folders become large-image
 * so 16-bit tiles and percentile stretch work in the viewer.
 */
export function inferSubfolderImportType(
  files: Pick<File, 'name'>[],
  options?: { largeImageForTiff?: boolean },
): 'image-sequence' | 'large-image' {
  const media = filterMediaFiles(files, 'image-sequence');
  if (!media.length) {
    return 'image-sequence';
  }
  if (options?.largeImageForTiff && media.every((file) => isTiffFileName(file.name))) {
    return 'large-image';
  }
  return 'image-sequence';
}

/**
 * Pick the default multicam display camera: prefer "center" / "middle", else the middle
 * camera in display order (for 3 cameras: index 1; for 2: index 0).
 */
export function pickDefaultMulticamCamera(
  cameraNames: string[],
  options?: { preferLeftForStereo?: boolean },
): string {
  if (!cameraNames.length) {
    return '';
  }

  const centerAliases = new Set<string>(DEFAULT_DISPLAY_NAME_ALIASES);
  const byAlias = cameraNames.find((name) => centerAliases.has(name.toLowerCase()));
  if (byAlias) {
    return byAlias;
  }

  const eo = cameraNames.find((name) => isEoSubfolderName(name));
  if (eo) {
    return eo;
  }

  if (options?.preferLeftForStereo) {
    const left = cameraNames.find((name) => name.toLowerCase() === 'left');
    if (left) {
      return left;
    }
    const leftCam = cameraNames.find((name) => name.toLowerCase().includes('left'));
    if (leftCam) {
      return leftCam;
    }
  }

  const middleIndex = Math.floor((cameraNames.length - 1) / 2);
  return cameraNames[middleIndex];
}

export function sortSubfolderCameraNames(names: string[]): string[] {
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const usePreferredOrder = PREFERRED_SUBFOLDER_ORDER.every((preferred) => lower.has(preferred.toLowerCase()));
  if (!usePreferredOrder) {
    return [...names].sort((a, b) => a.localeCompare(b));
  }
  const rank = (name: string) => {
    const idx = PREFERRED_SUBFOLDER_ORDER.findIndex(
      (preferred) => preferred.toLowerCase() === name.toLowerCase(),
    );
    return idx === -1 ? PREFERRED_SUBFOLDER_ORDER.length : idx;
  };
  return [...names].sort((a, b) => {
    const diff = rank(a) - rank(b);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

/** Move the subfolder named "left" (case-insensitive) to the front when present. */
export function preferLeftSubfolderFirst(names: string[]): string[] {
  const leftIndex = names.findIndex((name) => name.toLowerCase() === 'left');
  if (leftIndex <= 0) {
    return names;
  }
  const left = names[leftIndex];
  return [left, ...names.filter((_, index) => index !== leftIndex)];
}

/** Preserve discovery order unless STAR/CENTER/PORT are all present (then use preferred order). */
export function orderSubfolderCameraNames(
  names: string[],
  options?: { preferLeftFirst?: boolean },
): string[] {
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const usePreferredOrder = PREFERRED_SUBFOLDER_ORDER.every((preferred) => lower.has(preferred.toLowerCase()));
  let ordered: string[];
  if (usePreferredOrder) {
    ordered = sortSubfolderCameraNames(names);
  } else {
    const seen = new Set<string>();
    ordered = [];
    names.forEach((name) => {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(name);
      }
    });
  }
  if (options?.preferLeftFirst) {
    ordered = preferLeftSubfolderFirst(ordered);
  }
  return preferEoIrSubfolderOrder(ordered);
}

export function isValidCameraName(name: string): boolean {
  return CAMERA_NAME_PATTERN.test(name);
}

/**
 * Given immediate child folder names, create one camera per subfolder using the
 * folder name as the camera name (2 or 3 cameras, matching multicam import limits).
 */
/** Join parent directory with per-camera subfolder assignments (desktop / filesystem paths). */
export function applyParentPathToAssignments(
  parentPath: string,
  assignments: SubfolderCameraAssignment[],
): SubfolderCameraAssignment[] {
  const separator = parentPath.includes('\\') ? '\\' : '/';
  const normalized = parentPath.replace(/[\\/]+$/, '');
  return assignments.map((assignment) => ({
    ...assignment,
    sourcePath: `${normalized}${separator}${assignment.folderName}`,
  }));
}

export function organizeSubfolderCameras(
  folderNames: string[],
  options?: { preferLeftForStereo?: boolean },
): OrganizeSubfolderCamerasResult {
  const empty: OrganizeSubfolderCamerasResult = {
    assignments: [],
    layoutLabel: '',
    defaultDisplay: '',
    error: null,
  };

  const trimmed = folderNames.map((raw) => raw.trim()).filter(Boolean);
  const duplicate = trimmed.find(
    (name, index) => trimmed.findIndex((other) => other.toLowerCase() === name.toLowerCase()) !== index,
  );
  if (duplicate) {
    return {
      ...empty,
      error: `Duplicate subfolder name "${duplicate}"`,
    };
  }
  const unique = orderSubfolderCameraNames(trimmed, {
    preferLeftFirst: options?.preferLeftForStereo,
  });

  if (unique.length < 2 || unique.length > 3) {
    return {
      ...empty,
      error: `Expected 2 or 3 cameras (subfolders or video files), found ${unique.length} (${unique.join(', ')})`,
    };
  }

  const invalid = unique.filter((name) => !isValidCameraName(name));
  if (invalid.length) {
    return {
      ...empty,
      error: (
        `Subfolder names must be letters, numbers, and underscores only (no spaces): ${invalid.join(', ')}. `
        + 'Rename folders on disk or edit camera names after import.'
      ),
    };
  }

  const assignments: SubfolderCameraAssignment[] = unique.map((folderName) => ({
    cameraName: folderName,
    folderName,
    sourcePath: folderName,
  }));

  const cameraNames = assignments.map((a) => a.cameraName);

  return {
    assignments,
    layoutLabel: cameraNames.join(', '),
    defaultDisplay: pickDefaultMulticamCamera(cameraNames, {
      preferLeftForStereo: options?.preferLeftForStereo,
    }),
    error: null,
  };
}

/** Longest shared directory prefix across webkitRelativePath values. */
export function commonPathPrefix(paths: string[]): string {
  const splitPaths = paths.map((p) => p.split('/').filter(Boolean));
  if (!splitPaths.length) {
    return '';
  }
  if (splitPaths.some((parts) => parts.length <= 1)) {
    const first = paths[0];
    return first.includes('/') ? first.split('/').slice(0, -1).join('/') : '';
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

/** Last path segment of the common parent directory across absolute filesystem paths. */
export function parentFolderLabelFromAbsolutePaths(paths: string[]): string {
  const normalized = paths.map((p) => p.trim()).filter(Boolean);
  if (!normalized.length) {
    return '';
  }
  const withForwardSlashes = normalized.map((p) => p.replace(/\\/g, '/'));
  const parentPath = commonPathPrefix(withForwardSlashes);
  if (!parentPath) {
    return '';
  }
  const segments = parentPath.split('/').filter(Boolean);
  return segments[segments.length - 1] || parentPath;
}

function stripPathPrefix(path: string, prefix: string): string {
  if (!prefix) {
    return path;
  }
  const normalized = prefix.replace(/\/$/, '');
  const withSlash = `${normalized}/`;
  if (path.startsWith(withSlash)) {
    return path.slice(withSlash.length);
  }
  if (path.toLowerCase().startsWith(withSlash.toLowerCase())) {
    return path.slice(withSlash.length);
  }
  return path;
}

/**
 * Group browser files by immediate child folder under the selected parent directory.
 * Strips a common path prefix (from `root` or inferred from the file list) so paths like
 * `MyDataset/PORT/a.png` group under `PORT`, not `MyDataset`.
 */
export function groupFilesByImmediateSubfolder(
  fileList: File[],
  root = '',
): Map<string, File[]> {
  const groups = new Map<string, File[]>();
  const paths = fileList.map((file) => file.webkitRelativePath || file.name);
  const effectiveRoot = root || commonPathPrefix(paths);

  fileList.forEach((file, index) => {
    const rel = paths[index];
    const path = stripPathPrefix(rel, effectiveRoot);
    const parts = path.split('/').filter(Boolean);
    if (parts.length < 2) {
      return;
    }
    const subfolder = parts[0];
    const existing = groups.get(subfolder) ?? [];
    existing.push(file);
    groups.set(subfolder, existing);
  });

  return groups;
}

export function isVideoFileName(fileName: string): boolean {
  const parts = fileName.split('.');
  if (parts.length < 2) {
    return false;
  }
  const ext = parts.pop()?.toLowerCase() ?? '';
  return fileVideoTypes.includes(ext);
}

export function isImageFileName(fileName: string): boolean {
  const parts = fileName.split('.');
  if (parts.length < 2) {
    return false;
  }
  const ext = parts.pop()?.toLowerCase() ?? '';
  return fileImageTypes.includes(ext);
}

export function isMediaFileName(
  fileName: string,
  mediaType: 'image-sequence' | 'video',
): boolean {
  return mediaType === 'video' ? isVideoFileName(fileName) : isImageFileName(fileName);
}

export function filterMediaFiles(
  fileList: Pick<File, 'name'>[],
  mediaType: 'image-sequence' | 'video',
): Pick<File, 'name'>[] {
  return fileList.filter((file) => isMediaFileName(file.name, mediaType));
}

/** Drop subfolder groups that do not contain importable image or video files. */
export function filterSubfolderGroupsWithMedia(
  groups: Map<string, File[]>,
  mediaType: 'image-sequence' | 'video',
): Map<string, File[]> {
  const filtered = new Map<string, File[]>();
  groups.forEach((files, folderName) => {
    const mediaFiles = filterMediaFiles(files, mediaType) as File[];
    if (mediaFiles.length) {
      filtered.set(folderName, mediaFiles);
    }
  });
  return filtered;
}

/** Display label for a video camera in parent-folder import (includes file extension when known). */
export function subfolderVideoDisplayLabel(
  sourcePath: string,
  folderName: string,
  files: Pick<File, 'name'>[] = [],
): string {
  const videoFile = files.find((file) => isVideoFileName(file.name));
  if (videoFile) {
    return videoFile.name;
  }
  const fromPath = sourcePath.split(/[/\\]/).pop() || '';
  if (fromPath && isVideoFileName(fromPath)) {
    return fromPath;
  }
  return fromPath || folderName;
}

/**
 * Group video files that sit directly in the selected parent folder (one camera per file).
 * Camera keys are the file stem (basename without extension).
 */
export function groupRootLevelVideoFiles(
  fileList: File[],
  root = '',
): Map<string, File[]> {
  const groups = new Map<string, File[]>();
  const paths = fileList.map((file) => file.webkitRelativePath || file.name);
  const effectiveRoot = root || commonPathPrefix(paths);

  fileList.forEach((file, index) => {
    const rel = paths[index];
    const path = stripPathPrefix(rel, effectiveRoot);
    const parts = path.split('/').filter(Boolean);
    if (parts.length !== 1 || !isVideoFileName(parts[0])) {
      return;
    }
    const stem = parts[0].replace(/\.[^.]+$/, '');
    const existing = groups.get(stem) ?? [];
    existing.push(file);
    groups.set(stem, existing);
  });

  return groups;
}

/**
 * Group a parent-folder selection by camera: prefer immediate subfolders; for video imports,
 * fall back to separate video files in the parent folder when there are not enough subfolders.
 */
export function groupParentFolderByCamera(
  fileList: File[],
  options?: {
    allowRootLevelVideos?: boolean;
    mediaType?: 'image-sequence' | 'video';
  },
  root = '',
): Map<string, File[]> {
  const mediaType = options?.mediaType ?? 'image-sequence';
  const subfolderGroups = filterSubfolderGroupsWithMedia(
    groupFilesByImmediateSubfolder(fileList, root),
    mediaType,
  );
  if (subfolderGroups.size >= 2) {
    return subfolderGroups;
  }
  if (options?.allowRootLevelVideos) {
    const videoGroups = groupRootLevelVideoFiles(fileList, root);
    if (videoGroups.size >= 2) {
      return videoGroups;
    }
  }
  return subfolderGroups;
}
