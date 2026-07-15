/**
 * Discovery of DIVE camera-registration .json files in a multicam
 * parent-folder selection, shared by the web File-list scan here and the
 * desktop backend's findParentFolderTransformFiles.
 */
import { REGISTRATION_FILE_TYPE } from 'vue-media-annotator/alignedView/CameraRegistrationStore';
import { stripPathPrefix } from './stereoParentFolder';

/** Matches per-camera registration files. */
export const RegistrationFileNamePattern = /^.+_registration\.json$/i;

/**
 * Whether a root-level .json qualifies as a registration file: named like a
 * per-camera *_registration.json and carrying a "pairs" list (the
 * conventional name is the producer's declaration of intent, so `type` is
 * optional there -- matching every other load path), or, under any other
 * name, self-identifying with `type: 'dive-camera-registration'` -- so a
 * camera-rig calibration .json or other stray JSON in the collect root is
 * never grabbed by mistake.
 */
export function qualifiesAsRegistrationFile(fileName: string, data: unknown): boolean {
  const record = data as { pairs?: unknown; type?: unknown } | null | undefined;
  return Boolean(record && Array.isArray(record.pairs)
    && (RegistrationFileNamePattern.test(fileName) || record.type === REGISTRATION_FILE_TYPE));
}

/**
 * Candidate order for deterministic slot attachment: per-camera
 * *_registration.json files first, then other candidates, alphabetically
 * within each group.
 */
export function compareRegistrationCandidates(a: string, b: string): number {
  const rank = (name: string) => (RegistrationFileNamePattern.test(name) ? 0 : 1);
  return rank(a) - rank(b) || a.localeCompare(b);
}

/**
 * Assign discovered registration files to camera slots, shared by the
 * import dialog's parent-folder discovery and the batch scan: a file named
 * <camera>_registration.json or <camera>_to_*_registration.json goes to
 * that camera's slot, any other registration file goes to the first free
 * camera after the reference (cameraOrder[0]) -- the file's pairs name
 * their own cameras, so which slot carries it doesn't matter. Transforms
 * only apply to cameras after the reference, so a file matching an
 * already-filled slot or the reference itself is left unassigned.
 */
export function assignRegistrationFilesToCameras(
  filePaths: string[],
  cameraOrder: string[],
): { assignments: { camera: string; filePath: string }[]; unassigned: string[] } {
  const taken = new Set<string>([cameraOrder[0]]);
  const assignments: { camera: string; filePath: string }[] = [];
  const unassigned: string[] = [];
  filePaths.forEach((filePath) => {
    const fileName = filePath.replace(/^.*[\\/]/, '').toLowerCase();
    // Camera names may contain underscores, so match the file against each
    // known camera slot rather than parsing the name.
    const matched = cameraOrder.find((camera) => {
      const prefix = camera.toLowerCase();
      return fileName === `${prefix}_registration.json`
        || (fileName.startsWith(`${prefix}_to_`) && fileName.endsWith('_registration.json'));
    });
    let target: string | undefined;
    if (matched) {
      target = !taken.has(matched) ? matched : undefined;
    } else {
      target = cameraOrder.find((camera) => !taken.has(camera));
    }
    if (target) {
      taken.add(target);
      assignments.push({ camera: target, filePath });
    } else {
      unassigned.push(filePath);
    }
  });
  return { assignments, unassigned };
}

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
  candidates.sort((a, b) => compareRegistrationCandidates(a.path, b.path));
  const found: RegistrationFileMatch[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- candidates checked in priority order
      const data = JSON.parse(await candidate.file.text());
      if (qualifiesAsRegistrationFile(candidate.path, data)) {
        found.push(candidate);
      }
    } catch {
      // Unreadable/non-JSON candidates are simply not matches.
    }
  }
  return found;
}
