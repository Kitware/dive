/**
 * Shared helper for discovering DIVE camera-registration .json files in a
 * multicam parent-folder selection on web, mirroring the desktop backend's
 * findParentFolderTransformFiles: a root-level file qualifies when it is
 * named like a per-camera *_registration.json and carries a "pairs" list
 * (the conventional name is the producer's declaration of intent, so `type`
 * is optional there), or, under any other name, when it self-identifies
 * with `type: 'dive-camera-registration'`. Ordered for deterministic slot
 * attachment: per-camera *_registration.json files first, then other
 * self-identified candidates, alphabetically within each group.
 */
import { REGISTRATION_FILE_TYPE } from 'vue-media-annotator/alignedView/CameraRegistrationStore';
import { stripPathPrefix } from './stereoParentFolder';

export const RegistrationFileNamePattern = /^.+_registration\.json$/i;

export interface RegistrationFileMatch {
  /** Root-relative file name, used as the transformFile key. */
  path: string;
  file: File;
}

export async function findRegistrationFilesInFileList(
  fileList: File[],
  root: string,
  commonPathPrefix: (paths: string[]) => string,
): Promise<RegistrationFileMatch[]> {
  const paths = fileList.map((file) => file.webkitRelativePath || file.name);
  const effectiveRoot = root || commonPathPrefix(paths);
  const candidates: RegistrationFileMatch[] = [];
  fileList.forEach((file, index) => {
    const rel = stripPathPrefix(paths[index], effectiveRoot);
    const parts = rel.split('/').filter(Boolean);
    if (parts.length !== 1 || !/\.json$/i.test(parts[0])) {
      return;
    }
    candidates.push({ path: parts[0], file });
  });
  const rank = (name: string) => (RegistrationFileNamePattern.test(name) ? 0 : 1);
  candidates.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  const found: RegistrationFileMatch[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- candidates checked in priority order
      const data = JSON.parse(await candidate.file.text());
      const qualifies = data && Array.isArray(data.pairs)
        && (RegistrationFileNamePattern.test(candidate.path)
          || data.type === REGISTRATION_FILE_TYPE);
      if (qualifies) {
        found.push(candidate);
      }
    } catch {
      // Unreadable/non-JSON candidates are simply not matches.
    }
  }
  return found;
}
