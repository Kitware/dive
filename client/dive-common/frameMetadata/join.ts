import { fileImageTypes } from 'dive-common/components/ImportMultiCamDialog/multicamSubfolderLayout';
import { basicImageFileExtensions, largeImageFileExtensions } from 'dive-common/constants';
import type { FrameMetadataRow, FrameMetadataTable } from './parser';

type FrameRowMatch = Map<number, number>;

/** One camera's joined frame metadata. */
export interface ResolvedCameraFrameMetadata {
  /**
   * Payload column names in source order. A repeated name keeps its own column, so consumers
   * address cells by index rather than by name.
   */
  columns: string[];
  /** DIVE frame number -> cell values, positionally aligned with `columns`. */
  records: Record<number, FrameMetadataRow>;
  /** Attachment the rows came from, when the caller supplied one. */
  sourceName?: string;
}

export interface FrameAlignmentIndex {
  frameCount: number;
  frameByAlignmentKey: Map<string, number>;
  frameByCounter?: Map<number, number>;
}

export type JoinBlockedReason = 'invalid-declaration';

type JoinAttempt =
  | { status: 'not-applicable' }
  | { status: 'matched'; parsed: ResolvedCameraFrameMetadata }
  | { status: 'blocked'; reason: JoinBlockedReason };

// Alignment keys drop a media extension so a metadata cell like `img001.png` still matches an
// image stored as `img001.tif`. The allowlist is the union of what both platforms accept as image
// media: the web upload lists plus the desktop importer's set (which adds gif and avif).
const imageExtensions = new Set<string>([
  ...basicImageFileExtensions,
  ...largeImageFileExtensions,
  ...fileImageTypes,
]);
const TRAILING_DIGITS = /(\d+)$/;
const INTEGER_CELL = /^\d+$/;

// Split a basename like node path.extname: a leading dot is not an extension.
function splitExtension(basename: string): { stem: string; extension: string } {
  const dot = basename.lastIndexOf('.');
  if (dot <= 0) {
    return { stem: basename, extension: '' };
  }
  return { stem: basename.slice(0, dot), extension: basename.slice(dot + 1).toLowerCase() };
}

export function normalizeAlignmentKey(value: string): string {
  const basename = String(value).trim().split(/[\\/]/).pop() ?? '';
  const { stem, extension } = splitExtension(basename);
  return imageExtensions.has(extension) ? stem : basename;
}

export function extractCounter(stem: string): number | undefined {
  const match = TRAILING_DIGITS.exec(stem);
  if (match === null) {
    return undefined;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(value) ? value : undefined;
}

function cellCounter(cell: string): number | undefined {
  if (!INTEGER_CELL.test(cell)) {
    return undefined;
  }
  const value = Number.parseInt(cell, 10);
  return Number.isSafeInteger(value) ? value : undefined;
}

function columnIndices(header: string[]): number[] {
  return header.map((_, index) => index);
}

// First matching row wins for a frame; later rows claiming the same frame are ignored on every
// join tier.
function recordsFromMatches(
  matches: Iterable<readonly [frame: number, rowIndex: number]>,
  rows: FrameMetadataRow[],
  keptIndices: number[],
): Record<number, FrameMetadataRow> {
  const records: Record<number, FrameMetadataRow> = {};
  Array.from(matches).forEach(([frame, rowIndex]) => {
    if (!(frame in records)) {
      records[frame] = keptIndices.map((columnIndex) => rows[rowIndex][columnIndex]);
    }
  });
  return records;
}

function matchByFilename(
  table: FrameMetadataTable,
  index: FrameAlignmentIndex,
  sourceName?: string,
): JoinAttempt {
  const { header, rows } = table;
  if (header.length === 1) {
    // The lone column would be the filename itself, leaving nothing to display.
    return { status: 'not-applicable' };
  }
  const threshold = Math.min(2, rows.length, index.frameByAlignmentKey.size);
  const hits = (columnIndex: number) => rows.reduce((total, row) => (
    row[columnIndex] && index.frameByAlignmentKey.has(normalizeAlignmentKey(row[columnIndex]))
      ? total + 1
      : total
  ), 0);
  const qualifies = (columnIndex: number) => {
    const score = hits(columnIndex);
    return score >= threshold && score > 0;
  };
  // Leftmost qualifying column wins. A sibling camera's filename column in a shared multicamera
  // table scores nothing against this camera's media, so it never qualifies in the first place.
  const winner = columnIndices(header).find(qualifies);
  if (winner === undefined || columnIndices(header).every(qualifies)) {
    // Either nothing names this camera's media, or every column does and there is no payload.
    return { status: 'not-applicable' };
  }

  const keptIndices = columnIndices(header);
  const matches = rows
    .map((row, rowIndex): [number | undefined, number] => [
      index.frameByAlignmentKey.get(normalizeAlignmentKey(row[winner])),
      rowIndex,
    ])
    .filter((match): match is [number, number] => match[0] !== undefined);
  return matches.length === 0
    ? { status: 'not-applicable' }
    : {
      status: 'matched',
      parsed: {
        columns: header,
        records: recordsFromMatches(matches, rows, keptIndices),
        sourceName,
      },
    };
}

function matchByExplicitFrame(
  table: FrameMetadataTable,
  frameCount: number,
  sourceName?: string,
): JoinAttempt {
  const { header, rows } = table;
  const frameColumn = header.indexOf('frame');
  if (frameColumn === -1) {
    return { status: 'not-applicable' };
  }
  if (header.length === 1) {
    return { status: 'blocked', reason: 'invalid-declaration' };
  }

  const matches = rows
    .map((row, rowIndex): [number | undefined, number] => {
      const frame = cellCounter(row[frameColumn]);
      return [frame !== undefined && frame < frameCount ? frame : undefined, rowIndex];
    })
    .filter((match): match is [number, number] => match[0] !== undefined);
  return matches.length === 0
    ? { status: 'blocked', reason: 'invalid-declaration' }
    : {
      status: 'matched',
      parsed: {
        columns: header,
        records: recordsFromMatches(matches, rows, columnIndices(header)),
        sourceName,
      },
    };
}

function isStrictlyMonotonic(frames: number[]): boolean {
  if (frames.length < 2) {
    return true;
  }
  const direction = Math.sign(frames[1] - frames[0]);
  if (direction === 0) {
    return false;
  }
  return frames.slice(1).every((frame, index) => (
    Math.sign(frame - frames[index]) === direction
  ));
}

/**
 * The frame-to-row matches a counter column yields, or undefined when the column does not
 * qualify as this camera's counter: too few matches, a counter claimed by two rows, or matches
 * that do not advance in one direction as the rows do.
 */
function counterColumnMatches(
  columnIndex: number,
  rows: FrameMetadataRow[],
  counterIndex: Map<number, number>,
  threshold: number,
): FrameRowMatch | undefined {
  const matched: FrameRowMatch = new Map();
  const claimed = new Set<number>();
  let duplicateMatch = false;
  rows.forEach((row, rowIndex) => {
    const counter = cellCounter(row[columnIndex]);
    const frame = counter === undefined ? undefined : counterIndex.get(counter);
    if (counter === undefined || frame === undefined) {
      return;
    }
    if (claimed.has(counter)) {
      duplicateMatch = true;
      return;
    }
    claimed.add(counter);
    matched.set(frame, rowIndex);
  });
  if (duplicateMatch || matched.size < threshold) {
    return undefined;
  }
  const framesInRowOrder = Array.from(matched, ([frame, rowIndex]) => ({ frame, rowIndex }))
    .sort((a, b) => a.rowIndex - b.rowIndex)
    .map(({ frame }) => frame);
  return isStrictlyMonotonic(framesInRowOrder) ? matched : undefined;
}

function matchByCounter(
  table: FrameMetadataTable,
  counterIndex: Map<number, number> | undefined,
  sourceName?: string,
): JoinAttempt {
  const { header, rows } = table;
  if (counterIndex === undefined || counterIndex.size === 0 || header.length === 1) {
    // A lone counter column leaves nothing to display, so skip the scoring work entirely.
    return { status: 'not-applicable' };
  }
  const threshold = Math.min(2, rows.length, counterIndex.size);
  // Leftmost qualifying column wins, matching the filename tier.
  const matched = columnIndices(header).reduce<FrameRowMatch | undefined>(
    (found, columnIndex) => (
      found ?? counterColumnMatches(columnIndex, rows, counterIndex, threshold)
    ),
    undefined,
  );
  if (matched === undefined) {
    return { status: 'not-applicable' };
  }
  return {
    status: 'matched',
    parsed: {
      columns: header,
      records: recordsFromMatches(matched, rows, columnIndices(header)),
      sourceName,
    },
  };
}

export function resolveTableToFrames(
  table: FrameMetadataTable,
  frameContext: FrameAlignmentIndex,
  sourceName?: string,
): JoinAttempt {
  const filename = matchByFilename(table, frameContext, sourceName);
  if (filename.status !== 'not-applicable') {
    return filename;
  }

  const explicitFrame = matchByExplicitFrame(table, frameContext.frameCount, sourceName);
  if (explicitFrame.status !== 'not-applicable') {
    return explicitFrame;
  }

  return matchByCounter(table, frameContext.frameByCounter, sourceName);
}
