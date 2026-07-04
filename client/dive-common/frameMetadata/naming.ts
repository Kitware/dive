// Contract N-NAME: a frame-metadata sidecar is declared by its name ending in
// `.meta.csv` or `.meta.txt` (case-insensitive), not by content sniffing. This is the
// shared TypeScript mirror of the Python predicate
// `dive_utils.frame_metadata.is_frame_metadata_source_name`; the two are pinned by a
// shared accepted/rejected name list asserted in both a TS spec and a Python test
// (testdata/frame-metadata-conformance/source_names.expected.json). It is the only piece
// of logic mirrored across the platform boundary in this feature.
function isFrameMetadataSourceName(name: string): boolean {
  return /\.meta\.(csv|txt)$/i.test(name);
}

export {
  // eslint-disable-next-line import/prefer-default-export
  isFrameMetadataSourceName,
};
