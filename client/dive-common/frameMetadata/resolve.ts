import type { ResolvedFrameMetadata } from 'dive-common/apispec';
import { normalizeKey, parseFrameMetadataSource } from './parser';
import type { MediaKeyIndex, ParsedFrameMetadata } from './parser';

// The resolver joins a camera's candidate sidecar texts to its media list and merges them into
// the compact per-camera payload the Frame Info panel renders. It runs unchanged on both
// platforms (desktop backend and web renderer); the only platform difference is who supplies the
// candidate texts and media lists.

// camera key -> ordered [sourceName, rawText] candidates in precedence order (winner first:
// camera folder, then clone root, then dataset folder, then parent root).
type CameraCandidateTexts = Record<string, Array<[string, string]>>;

// camera key -> the media-key index for that camera's ordered media list.
type CameraMediaKeys = Record<string, MediaKeyIndex>;

// Contract READ-KEYS: build the media-key index tolerantly from an ordered media list (the frame
// number is the array position). Duplicate normalized basenames are last-wins -- never the
// throwing import-path validator -- so a duplicate can never blank a camera at read time.
// `normalizeKey` strips any directory prefix and one image extension, so entries may be bare
// filenames or full paths.
function buildMediaKeyIndex(mediaNames: string[]): MediaKeyIndex {
  const normalizedKeys = new Set<string>();
  const frameByKey = new Map<string, number>();
  mediaNames.forEach((name, frame) => {
    const key = normalizeKey(name);
    normalizedKeys.add(key);
    frameByKey.set(key, frame);
  });
  return { normalizedKeys, frameByKey };
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

// Resolve every camera's candidate sidecars against its media keys into the compact payload:
// per-camera frame -> row (values aligned to the camera's `columns`), the matched `sources`
// (winner first), and the `columns` order. A camera with no matching source is omitted.
function resolveCameras(
  cameraTexts: CameraCandidateTexts,
  mediaKeysPerCamera: CameraMediaKeys,
): ResolvedFrameMetadata {
  const cameras: ResolvedFrameMetadata['cameras'] = {};
  const sources: ResolvedFrameMetadata['sources'] = {};
  const columns: ResolvedFrameMetadata['columns'] = {};

  Object.entries(cameraTexts).forEach(([camera, candidates]) => {
    const index = mediaKeysPerCamera[camera];
    if (index === undefined) {
      return;
    }

    // Parse each candidate against this camera's shared index, in precedence order. The index is
    // normalized once and reused, so the join scoring never re-normalizes the media keys.
    const parsed = candidates
      .map(([sourceName, text]) => parseFrameMetadataSource(text, index, sourceName))
      .filter((source): source is ParsedFrameMetadata => source !== null);
    if (parsed.length === 0) {
      return;
    }

    const cameraColumns = unionColumns(parsed);

    // First-wins per-frame merge (Contract 1): the earliest candidate to claim a frame keeps it.
    // Each claimed frame materializes one compact row aligned to the camera's union columns; cells
    // a frame's winning source did not carry are empty strings.
    const records: Record<number, string[]> = {};
    const claimed = new Set<number>();
    parsed.forEach((source) => {
      Object.entries(source.records).forEach(([mediaKey, values]) => {
        const frame = index.frameByKey.get(mediaKey);
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
  buildMediaKeyIndex,
  resolveCameras,
};

export type {
  CameraCandidateTexts,
  CameraMediaKeys,
  MediaKeyIndex,
  ResolvedFrameMetadata,
};
