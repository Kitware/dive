// Contract N-NAME: a frame-metadata sidecar is declared by its basename:
// preferred `frame-metadata.csv` / `frame-metadata.txt`, with
// `frame_metadata.csv` / `frame_metadata.txt` are also accepted
// (case-insensitive), not by content sniffing. This is the
// shared TypeScript mirror of the Python predicate
// `dive_utils.frame_metadata.is_frame_metadata_source_name`; the two are pinned by a
// shared accepted/rejected name list asserted in both a TS spec and a Python test
// (testdata/frame-metadata-conformance/source_names.expected.json).
const FRAME_METADATA_SOURCE_NAMES = new Set([
  "frame-metadata.csv",
  "frame-metadata.txt",
  "frame_metadata.csv",
  "frame_metadata.txt",
]);

function isFrameMetadataSourceName(name: string): boolean {
  const basename = name.split(/[\\/]/).pop() ?? name;
  return FRAME_METADATA_SOURCE_NAMES.has(basename.toLowerCase());
}

export {
  // eslint-disable-next-line import/prefer-default-export
  isFrameMetadataSourceName,
};
