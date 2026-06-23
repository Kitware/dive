/** Shared helpers for stereoscopic parent-folder import (desktop and web). */

const STEREO_CALIBRATION_EXTENSIONS = new Set(['json', 'npz']);

/** True for .json / .npz files whose name contains "calibration" or "cal". */
export function isStereoCalibrationFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const parts = fileName.split('.');
  if (parts.length < 2) {
    return false;
  }
  const ext = parts.pop()?.toLowerCase() ?? '';
  if (!STEREO_CALIBRATION_EXTENSIONS.has(ext)) {
    return false;
  }
  return lower.includes('calibration') || lower.includes('cal');
}

function stereoCalibrationRank(fileName: string): number {
  const lower = fileName.toLowerCase();
  let score = 0;
  if (lower.includes('calibration')) {
    score += 2;
  } else if (lower.includes('cal')) {
    score += 1;
  }
  return score;
}

/** Pick the best calibration filename from a list of parent-folder root files. */
export function pickStereoCalibrationFileName(fileNames: string[]): string | null {
  const candidates = fileNames.filter(isStereoCalibrationFileName);
  if (!candidates.length) {
    return null;
  }
  return [...candidates].sort((a, b) => {
    const scoreDiff = stereoCalibrationRank(b) - stereoCalibrationRank(a);
    return scoreDiff !== 0 ? scoreDiff : a.localeCompare(b);
  })[0];
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

export interface StereoCalibrationFileMatch {
  path: string;
  file: File;
}

/** Find a stereo calibration file sitting directly in the selected parent folder (web). */
export function findStereoCalibrationInFileList(
  fileList: File[],
  root: string,
  commonPathPrefix: (paths: string[]) => string,
): StereoCalibrationFileMatch | null {
  const paths = fileList.map((file) => file.webkitRelativePath || file.name);
  const effectiveRoot = root || commonPathPrefix(paths);
  const matches: StereoCalibrationFileMatch[] = [];

  fileList.forEach((file, index) => {
    const rel = paths[index];
    const path = stripPathPrefix(rel, effectiveRoot);
    const parts = path.split('/').filter(Boolean);
    if (parts.length !== 1 || !isStereoCalibrationFileName(parts[0])) {
      return;
    }
    matches.push({ path: parts[0], file });
  });

  const bestName = pickStereoCalibrationFileName(matches.map((match) => match.path));
  if (!bestName) {
    return null;
  }
  return matches.find((match) => match.path === bestName) ?? null;
}
