import parseSync from 'csv-parse/lib/sync';
import path from 'path';
import { FrameMetadataSourceExtensions } from 'platform/desktop/constants';
import { isViameCsvRows } from 'platform/desktop/backend/serializers/viame';

type FrameMetadataRow = Record<string, string>;
type MediaKeys = Map<string, number> | Record<string, number>;
type Delimiter = ',' | '\t' | null;

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
const frameMetadataSourceExtensions = new Set<string>(FrameMetadataSourceExtensions);

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
  return parseTableRows(readRows(text));
}

function parseTableRows(rawRows: string[][]): { header: string[]; rows: FrameMetadataRow[] } {
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
  return findJoinColumnsForKeys(header, rows, normalizedKeySet(mediaKeys));
}

function findJoinColumnsForKeys(
  header: string[],
  rows: FrameMetadataRow[],
  normalizedMediaKeys: Set<string>,
): string[] {
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
  const { delimiter, rows: rawRows } = readRowsWithDelimiter(text);
  if (delimiter === ',' && isViameCsvRows(rawRows)) {
    return null;
  }

  const { header, rows } = parseTableRows(rawRows);
  if (header.length === 0 || rows.length === 0) {
    return null;
  }

  const normalizedMediaKeys = normalizedKeySet(mediaKeys);
  const joinColumns = findJoinColumnsForKeys(header, rows, normalizedMediaKeys);
  if (joinColumns.length === 0) {
    return null;
  }

  const payloadColumns = header.filter((column) => !joinColumns.includes(column));
  if (payloadColumns.length === 0) {
    return null;
  }

  const records: Record<string, FrameMetadataRow> = {};
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
    if (!isFrameMetadataSourceName(sourceName)) {
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
  return readRowsWithDelimiter(text).rows;
}

function readRowsWithDelimiter(text: string): { delimiter: Delimiter; rows: string[][] } {
  const firstLine = firstNonemptyLine(text);
  if (firstLine === null) {
    return { delimiter: null, rows: [] };
  }

  const delimiter = sniffDelimiter(firstLine);
  if (delimiter === null) {
    return {
      delimiter,
      rows: text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => line.trim().split(/\s+/)),
    };
  }

  return { delimiter, rows: parseDelimited(text, delimiter) };
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

function isFrameMetadataSourceName(sourceName: string): boolean {
  return frameMetadataSourceExtensions.has(path.extname(sourceName).toLowerCase());
}

export {
  FrameMetadataRow,
  MediaKeys,
  ParsedFrameMetadata,
  findJoinColumns,
  isFrameMetadata,
  isFrameMetadataSourceName,
  normalizeKey,
  parseFrameMetadataSource,
  parseTable,
  selectFrameMetadataSource,
};
