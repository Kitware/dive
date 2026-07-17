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
