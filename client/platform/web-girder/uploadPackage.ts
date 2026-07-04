/**
 * Pure browser-side helper that turns a validated upload response into the exact
 * list of File objects to send to Girder.
 *
 * The server validation response is the single authority for which files upload.
 * This helper never re-classifies files: it only maps the server's `upload` name
 * list back onto the user's original File objects, preserving order and duplicate
 * handling, and passes the role map and ignored list straight through.
 */

import type {
  IgnoredUploadFile,
  ValidatedUploadRoleMap,
  ValidationResponse,
} from './api/dataset.service';

export interface ValidatedUploadPackage {
  uploadFiles: File[];
  roles: ValidatedUploadRoleMap;
  ignored: IgnoredUploadFile[];
}

/**
 * Build the validated upload package from the user's selection and the server
 * validation response.
 *
 * - `uploadFiles` is drawn from `validation.upload`, in order, mapped back to the
 *   original File objects. A name listed more times than it was selected, or a
 *   name that was never selected, throws a client Error.
 * - Files the server placed in `ignored` are never in `validation.upload`, so they
 *   are naturally excluded from `uploadFiles`.
 * - `roles` and `ignored` are passed through unchanged.
 */
export function buildValidatedUploadPackage(
  selectedFiles: File[],
  validation: ValidationResponse,
): ValidatedUploadPackage {
  const filesByName = new Map<string, File[]>();
  selectedFiles.forEach((file) => {
    const existing = filesByName.get(file.name);
    if (existing) {
      existing.push(file);
    } else {
      filesByName.set(file.name, [file]);
    }
  });

  const uploadFiles = validation.upload.map((name) => {
    // Consume selected files in order so duplicate names are preserved only as
    // many times as validation lists them.
    const file = filesByName.get(name)?.shift();
    if (!file) {
      throw new Error(
        `Upload validation referenced "${name}", which is not among the selected files.`,
      );
    }
    return file;
  });

  return {
    uploadFiles,
    roles: validation.roles,
    ignored: validation.ignored,
  };
}
