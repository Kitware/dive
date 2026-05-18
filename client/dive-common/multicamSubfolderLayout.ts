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

/** Same rules as manual "Add Camera" in ImportMultiCamAddType. */
export const CAMERA_NAME_PATTERN = /^[a-zA-Z0-9]+$/;

/** Preferred camera order when subfolders use these names (case-insensitive). */
export const PREFERRED_SUBFOLDER_ORDER = ['STAR', 'CENTER', 'PORT'] as const;

/** Camera names that should be the default display when present (case-insensitive). */
export const DEFAULT_DISPLAY_NAME_ALIASES = ['center', 'middle'] as const;

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

/** Preserve discovery order unless STAR/CENTER/PORT are all present (then use preferred order). */
export function orderSubfolderCameraNames(names: string[]): string[] {
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const usePreferredOrder = PREFERRED_SUBFOLDER_ORDER.every((preferred) => lower.has(preferred.toLowerCase()));
  if (usePreferredOrder) {
    return sortSubfolderCameraNames(names);
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  names.forEach((name) => {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(name);
    }
  });
  return ordered;
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

export function organizeSubfolderCameras(folderNames: string[]): OrganizeSubfolderCamerasResult {
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
  const unique = orderSubfolderCameraNames(trimmed);

  if (unique.length < 2 || unique.length > 3) {
    return {
      ...empty,
      error: `Expected 2 or 3 camera subfolders, found ${unique.length} (${unique.join(', ')})`,
    };
  }

  const invalid = unique.filter((name) => !isValidCameraName(name));
  if (invalid.length) {
    return {
      ...empty,
      error: (
        `Subfolder names must be letters and numbers only (no spaces): ${invalid.join(', ')}. `
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
    defaultDisplay: pickDefaultMulticamCamera(cameraNames),
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
