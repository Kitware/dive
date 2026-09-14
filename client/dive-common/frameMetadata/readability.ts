// Keep this extension-only predicate shared by the platform attachment loaders (web
// platform/web-girder/api/frameMetadata.service.ts, desktop platform/desktop/backend/native/common.ts)
// because a name the parser cannot read must still be handed to pipelines untouched, and the two
// loaders drifting would make the same file readable on one platform and opaque on the other.
const READABLE_ATTACHMENT_EXTENSION = /\.(csv|txt)$/i;

/** True when an attachment name is one the frame metadata parser is allowed to read. */
export function isFrameMetadataReadableName(name: string): boolean {
  return READABLE_ATTACHMENT_EXTENSION.test(name);
}

/**
 * Shown when a declared attachment exists but its bytes could not be read.
 *
 * The web server emits this same string from `_metadata_attachment` in
 * `server/dive_server/crud_dataset.py`, so the two copies must stay byte-identical: the client
 * surfaces whichever one produced the response, and a drift would show two different errors for
 * the same condition depending on which side detected it.
 */
export const METADATA_ATTACHMENT_UNAVAILABLE = 'Metadata attachment is unavailable.';
