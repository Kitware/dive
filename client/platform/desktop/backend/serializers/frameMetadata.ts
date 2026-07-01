import parseSync from 'csv-parse/lib/sync';
import path from 'path';

type FrameMetadataRow = Record<string, string>;
type MediaKeys = Map<string, number> | Record<string, number>;

interface ParsedFrameMetadata {
  sourceName?: string;
  header: string[];
  rows: FrameMetadataRow[];
  joinColumns: string[];
  payloadColumns: string[];
  records: Record<string, FrameMetadataRow>;
}

const imageExtensions = new Set([
  'png',
  'jpg',
  'jpeg',
  'sgi',
  'bmp',
  'pgm',
  'nitf',
  'tif',
  'tiff',
  'ntf',
  'vrt',
  'r0',
  'r1',
  'r2',
  'r3',
  'r4',
  'r5',
  'r6',
]);

function normalizeKey(value: string): string {
  const basename = path.basename(String(value).trim());
  const ext = path.extname(basename);
  const extension = ext.toLowerCase().replace(/^\./, '');
  if (imageExtensions.has(extension)) {
    return path.basename(basename, ext);
  }
  return basename;
}

function parseTable(text: string): { header: string[]; rows: FrameMetadataRow[] } {
  const rawRows = readRows(text);
  if (rawRows.length === 0) {
    return { header: [], rows: [] };
  }

  const header = rawRows[0].map((cell) => cell.trim());
  if (!header.every((cell) => cell.length > 0)) {
    return { header: [], rows: [] };
  }

  const rows: FrameMetadataRow[] = [];
  rawRows.slice(1).forEach((rawRow) => {
    const values = rawRow.map((cell) => cell.trim());
    if (!values.some((cell) => cell.length > 0)) {
      return;
    }
    const row: FrameMetadataRow = {};
    header.forEach((field, index) => {
      row[field] = values[index] || '';
    });
    rows.push(row);
  });
  return { header, rows };
}

function findJoinColumns(
  header: string[],
  rows: FrameMetadataRow[],
  mediaKeys: MediaKeys,
): string[] {
  const normalizedMediaKeys = normalizedKeySet(mediaKeys);
  return header.filter((column) => rows.some((row) => (
    row[column] && normalizedMediaKeys.has(normalizeKey(row[column]))
  )));
}

function isFrameMetadata(text: string, mediaKeys: MediaKeys): boolean {
  return parseFrameMetadataSource(text, mediaKeys) !== null;
}

function parseFrameMetadataSource(
  text: string,
  mediaKeys: MediaKeys,
  sourceName?: string,
): ParsedFrameMetadata | null {
  if (isViameCsv(text)) {
    return null;
  }

  const { header, rows } = parseTable(text);
  if (header.length === 0 || rows.length === 0) {
    return null;
  }

  const joinColumns = findJoinColumns(header, rows, mediaKeys);
  if (joinColumns.length === 0) {
    return null;
  }

  const payloadColumns = header.filter((column) => !joinColumns.includes(column));
  if (payloadColumns.length === 0) {
    return null;
  }

  const records: Record<string, FrameMetadataRow> = {};
  const normalizedMediaKeys = normalizedKeySet(mediaKeys);
  rows.forEach((row) => {
    joinColumns.forEach((column) => {
      const key = normalizeKey(row[column] || '');
      if (normalizedMediaKeys.has(key)) {
        const record: FrameMetadataRow = {};
        header.forEach((field) => {
          record[field] = row[field] || '';
        });
        records[key] = record;
      }
    });
  });

  if (Object.keys(records).length === 0) {
    return null;
  }

  return {
    sourceName,
    header,
    rows,
    joinColumns,
    payloadColumns,
    records,
  };
}

function selectFrameMetadataSource(
  candidates: [string, string][],
  mediaKeys: MediaKeys,
): ParsedFrameMetadata | null {
  const matches: ParsedFrameMetadata[] = [];
  candidates.forEach(([sourceName, text]) => {
    if (!isTextCandidate(sourceName)) {
      return;
    }
    const source = parseFrameMetadataSource(text, mediaKeys, sourceName);
    if (source !== null) {
      matches.push(source);
    }
  });

  if (matches.length !== 1) {
    return null;
  }
  return matches[0];
}

function readRows(text: string): string[][] {
  const firstLine = firstNonemptyLine(text);
  if (firstLine === null) {
    return [];
  }

  const delimiter = sniffDelimiter(firstLine);
  if (delimiter === null) {
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => line.trim().split(/\s+/));
  }

  return parseDelimited(text, delimiter);
}

function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
  return parseSync(text, {
    delimiter,
    relax_column_count: true,
    // Telemetry sidecars routinely contain bare quote characters (e.g. depth
    // 5"); `relax` treats a stray quote in an unquoted field as a literal
    // character instead of throwing, matching Python's lenient csv.reader on
    // the server while still honoring properly quoted fields.
    relax: true,
    skip_empty_lines: true,
  }).map((row: string[]) => row.map((cell) => cell.trim()));
}

function firstNonemptyLine(text: string): string | null {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0);
  return line === undefined ? null : line.trim();
}

function sniffDelimiter(line: string): ',' | '\t' | null {
  if (line.includes(',')) {
    return ',';
  }
  if (line.includes('\t')) {
    return '\t';
  }
  return null;
}

function normalizedKeySet(mediaKeys: MediaKeys): Set<string> {
  if (mediaKeys instanceof Map) {
    return new Set(Array.from(mediaKeys.keys()).map((key) => normalizeKey(key)));
  }
  return new Set(Object.keys(mediaKeys).map((key) => normalizeKey(key)));
}

function isTextCandidate(sourceName: string): boolean {
  return ['.txt', '.csv'].includes(path.extname(sourceName).toLowerCase());
}

function isViameCsv(text: string): boolean {
  const rows = parseDelimited(text, ',');
  let hasHeader = false;
  let hasDataRow = false;
  let firstRowIsDetection = false;
  let seenDataRow = false;

  rows.forEach((row) => {
    if (row.length === 0) {
      return;
    }
    if (row[0].startsWith('#')) {
      hasHeader = hasHeader || row[0].startsWith('# 1: Detection or Track-id');
      return;
    }
    if (!seenDataRow) {
      seenDataRow = true;
      firstRowIsDetection = isViameDataRow(row);
    }
    if (isViameDataRow(row)) {
      hasDataRow = true;
    }
  });

  // A headerless VIAME CSV (no text header) leads with a detection row; a DIVE
  // export carries the comment header. Telemetry leads with a field-name header
  // that is not VIAME-shaped, so it is left for the frame metadata parser.
  return hasDataRow && (hasHeader || firstRowIsDetection);
}

function isViameDataRow(row: string[]): boolean {
  if (row.length < 9) {
    return false;
  }
  const trackId = Number.parseInt(row[0], 10);
  const frame = Number.parseInt(row[2], 10);
  const bounds = row.slice(3, 7).map((value) => Number.parseFloat(value));
  const fishLength = Number.parseFloat(row[8]);
  return (
    Number.isFinite(trackId)
    && Number.isFinite(frame)
    && bounds.every((value) => Number.isFinite(value))
    && Number.isFinite(fishLength)
  );
}

export {
  FrameMetadataRow,
  MediaKeys,
  ParsedFrameMetadata,
  findJoinColumns,
  isFrameMetadata,
  normalizeKey,
  parseFrameMetadataSource,
  parseTable,
  selectFrameMetadataSource,
};
