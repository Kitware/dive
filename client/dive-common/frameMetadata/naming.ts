// Keep this basename-only predicate mirrored with the server helper because matching names are
// auto-read as frame metadata instead of imported as annotations.
const FRAME_METADATA_SOURCE_NAMES = new Set([
  'frame-metadata.csv',
  'frame-metadata.txt',
  'frame_metadata.csv',
  'frame_metadata.txt',
]);

export default function isFrameMetadataSourceName(name: string): boolean {
  const basename = name.split(/[\\/]/).pop() ?? name;
  return FRAME_METADATA_SOURCE_NAMES.has(basename.toLowerCase());
}
