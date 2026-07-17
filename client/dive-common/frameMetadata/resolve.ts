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

    // Column-level first-wins: for each frame and column, the value comes from the first source
    // (in precedence order) that defines the column in its header and has a row for that frame.
    // A defined column claims its cell even when the value is empty, so a higher-precedence blank
    // is not overwritten, while columns a source never defines stay open for fallback locations.
    const records: Record<number, string[]> = {};
    cameraColumns.forEach((column, position) => {
      const claimedFrames = new Set<number>();
      parsed
        .filter((source) => source.columns.includes(column))
        .forEach((source) => {
          Object.entries(source.records).forEach(([alignmentKey, values]) => {
            const frame = index.frameByAlignmentKey.get(alignmentKey);
            if (frame === undefined || claimedFrames.has(frame)) {
              return;
            }
            claimedFrames.add(frame);
            if (records[frame] === undefined) {
              records[frame] = cameraColumns.map(() => '');
            }
            records[frame][position] = values[column] ?? '';
          });
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
