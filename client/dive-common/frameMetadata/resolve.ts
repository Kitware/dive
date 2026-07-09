import type { ResolvedFrameMetadata } from 'dive-common/apispec';
import { frameAlignmentIndexFromEntries, parseFrameMetadataSource } from './parser';
import type { FrameAlignmentIndex, ParsedFrameMetadata } from './parser';

type CameraCandidateTexts = Record<string, [sourceName: string, rawText: string][]>;
type CameraFrameAlignmentIndexes = Record<string, FrameAlignmentIndex>;

// The read path must tolerate duplicate basenames because rejecting here would hide all metadata
// for the camera. Later media entries win for consistency with the ordered media list.
function buildFrameAlignmentIndex(mediaNames: string[]): FrameAlignmentIndex {
  return frameAlignmentIndexFromEntries(mediaNames.map((name, frame) => [name, frame]));
}

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

    const parsed = candidates
      .map(([sourceName, text]) => parseFrameMetadataSource(text, index, sourceName))
      .filter((source): source is ParsedFrameMetadata => source !== null);
    if (parsed.length === 0) {
      return;
    }

    const cameraColumns = unionColumns(parsed);

    // Higher-precedence sidecars should not be overwritten by fallback locations.
    const records: Record<number, string[]> = {};
    parsed.forEach((source) => {
      Object.entries(source.records).forEach(([alignmentKey, values]) => {
        const frame = index.frameByAlignmentKey.get(alignmentKey);
        if (frame === undefined || records[frame] !== undefined) {
          return;
        }
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
