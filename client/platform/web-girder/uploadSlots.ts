import { JsonConfigRegEx } from 'dive-common/constants';
import type { IgnoredUploadFile } from './api/dataset.service';

export interface SuggestedUploadSlots {
  mediaList: File[];
  annotationFile: File | null;
  configFile: File | null;
  /**
   * Picked files no slot can hold, each with the reason. A dataset takes at most one
   * annotation source, so the extras are reported to the user instead of being placed in a
   * slot that would make the whole selection fail validation.
   */
  unslotted: IgnoredUploadFile[];
}

const ONE_ANNOTATION_REASON = 'Only one annotation file can be uploaded per dataset';
const ONE_CONFIG_REASON = 'Only one configuration file can be uploaded per dataset';

/** Files the server classifies as annotation sources, in the order this split prefers them. */
function annotationCandidates(files: File[], configFiles: File[]): File[] {
  const matching = (test: (name: string) => boolean) => files.filter(
    (file) => !configFiles.includes(file) && test(file.name),
  );
  return [
    ...matching((name) => name.includes('.csv')),
    ...matching((name) => name.includes('.yml') || name.includes('.yaml')),
    ...matching((name) => name.includes('.json')),
  ];
}

/**
 * Auto-suggest a picked selection into the per-role upload slots.
 *
 * Placement is a convenience split the server re-validates at upload. Every input file lands
 * in exactly one slot or in `unslotted`, so nothing the user picked is ever silently dropped.
 */
export default function suggestUploadSlots(fileList: File[]): SuggestedUploadSlots {
  const configFiles = fileList.filter((f) => JsonConfigRegEx.test(f.name));
  const [configFile = null, ...extraConfigs] = configFiles;
  const [annotationFile = null, ...extraAnnotations] = annotationCandidates(fileList, configFiles);
  const claimed = new Set<File>([
    ...configFiles,
    ...(annotationFile ? [annotationFile] : []),
    ...extraAnnotations,
  ]);
  return {
    mediaList: fileList.filter((f) => !claimed.has(f)),
    annotationFile,
    configFile,
    unslotted: [
      ...extraAnnotations.map((f) => ({ name: f.name, reason: ONE_ANNOTATION_REASON })),
      ...extraConfigs.map((f) => ({ name: f.name, reason: ONE_CONFIG_REASON })),
    ],
  };
}
