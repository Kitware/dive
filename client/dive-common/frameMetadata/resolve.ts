import type { ResolvedFrameMetadata } from 'dive-common/apispec';
import { frameAlignmentIndexFromEntries, parseFrameMetadataSource } from './parser';
import type { FrameAlignmentIndex, ParsedFrameMetadata } from './parser';

// The resolver joins a camera's candidate sidecar texts to its media list and merges them into
// the compact per-camera payload the Frame Info panel renders. It runs unchanged on both
// platforms (desktop backend and web renderer); the only platform difference is who supplies the
// candidate texts and media lists.

// camera key -> ordered [sourceName, rawText] candidates in precedence order (winner first:
// camera folder, then clone root, then dataset folder, then parent root).
type CameraCandidateTexts = Record<string, Array<[string, string]>>;

// camera key -> the alignment-key index for that camera's ordered media list.
type CameraFrameAlignmentIndexes = Record<string, FrameAlignmentIndex>;

// The read path must tolerate duplicate basenames because rejecting here would hide all metadata
// for the camera. Later media entries win for consistency with the ordered media list.
function buildFrameAlignmentIndex(mediaNames: string[]): FrameAlignmentIndex {
  return frameAlignmentIndexFromEntries(mediaNames.map((name, frame) => [name, frame]));
}

// Ordered union of the payload columns across a camera's parsed sources: the first (winning)
// source's columns first in file order, then any new columns later sources introduce. An explicit
// array (never object keys) keeps numeric-named headers in file order, fixing readtime deferred
// finding #8 where structured-clone / JS object-key order reordered numeric column names.
function unionColumns(sources: ParsedFrameMetadata[]): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  sources.forEach((source) => {
    source.columns.forEach((column) => {
      if (!seen.has(column)) {
        seen.add(column);
        columns.push(column);
      }
    });
  });
  return columns;
}

// Resolve every camera's candidate sidecars against its alignment keys into the compact payload:
// per-camera frame -> row (values aligned to the camera's `columns`), the matched `sources`
// (winner first), and the `columns` order. A camera with no matching source is omitted.
function resolveCameras(
  cameraTexts: CameraCandidateTexts,
  alignmentIndexesByCamera: CameraFrameAlignmentIndexes,
): ResolvedFrameMetadata {
  const cameras: ResolvedFrameMetadata['cameras'] = {};
  const sources: ResolvedFrameMetadata['sources'] = {};
  const columns: ResolvedFrameMetadata['columns'] = {};

  Object.entries(cameraTexts).forEach(([camera, candidates]) => {
    const index = alignmentIndexesByCamera[camera];
    if (index === undefined) {
      return;
    }

    // Parse each candidate against this camera's shared index, in precedence order. The index is
    // normalized once and reused, so the join scoring never re-normalizes the alignment keys.
    const parsed = candidates
      .map(([sourceName, text]) => parseFrameMetadataSource(text, index, sourceName))
      .filter((source): source is ParsedFrameMetadata => source !== null);
    if (parsed.length === 0) {
      return;
    }

    const cameraColumns = unionColumns(parsed);

    // Higher-precedence sidecars should not be overwritten by fallback locations.
    const records: Record<number, string[]> = {};
    const claimed = new Set<number>();
    parsed.forEach((source) => {
      Object.entries(source.records).forEach(([alignmentKey, values]) => {
        const frame = index.frameByAlignmentKey.get(alignmentKey);
        if (frame === undefined || claimed.has(frame)) {
          return;
        }
        claimed.add(frame);
        records[frame] = cameraColumns.map((column) => values[column] ?? '');
      });
    });

    cameras[camera] = records;
    columns[camera] = cameraColumns;
    sources[camera] = parsed
      .map((source) => source.sourceName)
      .filter((name): name is string => name !== undefined);
  });

  return { cameras, sources, columns };
}

export {
  buildFrameAlignmentIndex,
  resolveCameras,
};

export type {
  CameraCandidateTexts,
  CameraFrameAlignmentIndexes,
  FrameAlignmentIndex,
  ResolvedFrameMetadata,
};
