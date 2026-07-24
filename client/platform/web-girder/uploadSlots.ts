import isFrameMetadataSourceName from 'dive-common/frameMetadata/naming';
import { JsonConfigRegEx } from 'dive-common/constants';
import type { IgnoredUploadFile } from './api/dataset.service';

export interface SuggestedUploadSlots {
  mediaList: File[];
  annotationFile: File | null;
  configFile: File | null;
  metadataFile: File | null;
  /**
   * Picked files no slot can hold, each with the reason. A dataset takes at most one
   * annotation source and one metadata attachment, so the extras are reported to the user
   * instead of being placed in a slot that would make the whole selection fail validation.
   */
  unslotted: IgnoredUploadFile[];
}

const ONE_ANNOTATION_REASON = 'Only one annotation file can be uploaded per dataset';
const ONE_CONFIG_REASON = 'Only one configuration file can be uploaded per dataset';
const ONE_METADATA_REASON = 'Only one metadata file can be uploaded per dataset';

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
 * Only a reserved-name attachment is assigned to the metadata slot here;
 * media/annotation/config placement is a convenience split the server re-validates at upload.
 * Every input file lands in exactly one slot or in `unslotted`, so nothing the user picked is
 * ever silently dropped.
 */
export default function suggestUploadSlots(fileList: File[]): SuggestedUploadSlots {
  const isMetadata = (file: File) => isFrameMetadataSourceName(file.name);
  const rest = fileList.filter((file) => !isMetadata(file));
  const [metadataFile = null, ...extraMetadata] = fileList.filter(isMetadata);
  const configFiles = rest.filter((f) => JsonConfigRegEx.test(f.name));
  const [configFile = null, ...extraConfigs] = configFiles;
  const [annotationFile = null, ...extraAnnotations] = annotationCandidates(rest, configFiles);
  const claimed = new Set<File>([
    ...configFiles,
    ...(annotationFile ? [annotationFile] : []),
    ...extraAnnotations,
  ]);
  return {
    mediaList: rest.filter((f) => !claimed.has(f)),
    annotationFile,
    configFile,
    metadataFile,
    unslotted: [
      ...extraAnnotations.map((f) => ({ name: f.name, reason: ONE_ANNOTATION_REASON })),
      ...extraConfigs.map((f) => ({ name: f.name, reason: ONE_CONFIG_REASON })),
      ...extraMetadata.map((f) => ({ name: f.name, reason: ONE_METADATA_REASON })),
    ],
  };
}
