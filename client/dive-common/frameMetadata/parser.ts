import { basicImageFileExtensions, largeImageFileExtensions } from 'dive-common/constants';

// Shared by the desktop backend and the web client. Keep this node-free so the same parser runs
// in Electron and in the browser renderer.

type FrameMetadataRow = Record<string, string>;
type MediaKeys = Map<string, number> | Record<string, number>;

interface ParsedFrameMetadata {
  sourceName?: string;
  // Payload column names in file order; the resolver relies on this to avoid JS object-key
  // reordering for numeric-named headers.
  columns: string[];
  // Records keyed by normalized media key; each record is a null-prototype {field: value} map.
  records: Record<string, FrameMetadataRow>;
}

// Parser call sites share this shape so join scoring never mixes raw filenames with normalized
// media keys.
interface MediaKeyIndex {
  normalizedKeys: Set<string>;
  frameByKey: Map<string, number>;
}

// Mirror of the server's allValidLargeImageFormats (validImageFormats + validLargeImageFormats):
// the extensions normalizeKey strips so a filename cell matches its media key.
const imageExtensions = new Set<string>([
  ...basicImageFileExtensions,
  ...largeImageFileExtensions,
]);

// Match Python's csv.field_size_limit() default so browser and desktop reject pathological cells
// consistently.
const FIELD_SIZE_LIMIT = 131072;

// Split a basename into (stem, lowercased extension). Mirrors node path.extname semantics: a
// leading dot is not an extension (so '.gitignore' has no extension), matching how the server
// strips one image extension from a media key.
function splitExtension(basename: string): { stem: string; extension: string } {
  const dot = basename.lastIndexOf('.');
  if (dot <= 0) {
    return { stem: basename, extension: '' };
  }
  return { stem: basename.slice(0, dot), extension: basename.slice(dot + 1).toLowerCase() };
}

function normalizeKey(value: string): string {
  // Split on both separators so Windows-style path cells (images\IMG.png) normalize the same way
  // they would on a posix build. Strip exactly one image extension so a filename cell matches its
  // media key.
  const basename = String(value).trim().split(/[\\/]/).pop() ?? '';
  const { stem, extension } = splitExtension(basename);
  return imageExtensions.has(extension) ? stem : basename;
}

// Build the shared media-key index from (name, frame) entries: normalize each name and record it,
// last-wins on a normalized-key collision. The single owner of the normalize + collision rule,
// shared by the read path's ordered builder (buildMediaKeyIndex in resolve.ts) and the raw-map
// normalizer below, so the two can never drift.
export function indexFromEntries(entries: Iterable<[string, number]>): MediaKeyIndex {
  const normalizedKeys = new Set<string>();
  const frameByKey = new Map<string, number>();
  Array.from(entries).forEach(([name, frame]) => {
    const key = normalizeKey(name);
    normalizedKeys.add(key);
    frameByKey.set(key, frame);
  });
  return { normalizedKeys, frameByKey };
}

// Normalize a raw media-key mapping (a Map or plain object of name -> frame) to the shared index.
// Serves specs with explicit frame numbers; the production read path builds its index from an
// ordered media list via buildMediaKeyIndex instead.
function normalizeMediaKeys(mediaKeys: MediaKeys): MediaKeyIndex {
  return indexFromEntries(mediaKeys instanceof Map ? mediaKeys : Object.entries(mediaKeys));
}

function isMediaKeyIndex(value: MediaKeyIndex | MediaKeys): value is MediaKeyIndex {
  return !(value instanceof Map) && (value as MediaKeyIndex).normalizedKeys instanceof Set;
}

function splitCommentBlock(
  rawRows: string[][],
): { commentBlock: string[][]; body: string[][] } {
  let index = 0;
  while (index < rawRows.length && rawRows[index].length > 0 && rawRows[index][0].startsWith('#')) {
    index += 1;
  }
  return { commentBlock: rawRows.slice(0, index), body: rawRows.slice(index) };
}

// Drop the leading `#` from a comment row: a standalone `#` first token is removed
// entirely, otherwise the marker is stripped from the first cell.
function stripCommentMarker(row: string[]): string[] {
  const cells = row.map((cell) => cell.trim());
  if (cells.length === 0) {
    return cells;
  }
  if (cells[0] === '#') {
    return cells.slice(1);
  }
  if (cells[0].startsWith('#')) {
    const first = cells[0].slice(1).trim();
    return (first ? [first] : []).concat(cells.slice(1));
  }
  return cells;
}

function buildTable(
  headerCells: string[],
  dataRows: string[][],
): { header: string[]; rows: FrameMetadataRow[] } {
  const rawHeader = headerCells.map((cell) => cell.trim());
  // Keep only columns with a non-empty header cell (drop pandas index / trailing-comma
  // columns) instead of rejecting the whole table.
  const keptIndices = rawHeader
    .map((cell, index) => (cell.length > 0 ? index : -1))
    .filter((index) => index >= 0);
  if (keptIndices.length === 0) {
    return { header: [], rows: [] };
  }
  const header = keptIndices.map((index) => rawHeader[index]);

  const rows: FrameMetadataRow[] = [];
  dataRows.forEach((rawRow) => {
    const values = rawRow.map((cell) => cell.trim());
    if (!values.some((cell) => cell.length > 0)) {
      return;
    }
    // Pad short rows so kept indices resolve, matching the Python zip padding.
    while (values.length < rawHeader.length) {
      values.push('');
    }
    // Null-prototype so a "__proto__" (or other reserved) header cannot corrupt the row.
    const row: FrameMetadataRow = Object.create(null);
    keptIndices.forEach((index, position) => {
      row[header[position]] = values[index] || '';
    });
    rows.push(row);
  });
  return { header, rows };
}

// Sidecars may include multiple image columns; score by media-key matches so each camera can use
// its own column while ties remain stable in file order.
function selectJoinColumn(
  header: string[],
  rows: FrameMetadataRow[],
  normalizedMediaKeys: Set<string>,
): { joinColumn: string | null; candidates: string[] } {
  const threshold = Math.min(2, rows.length);
  const scores = new Map<string, number>();
  header.forEach((column) => {
    const score = rows.reduce((total, row) => (
      row[column] && normalizedMediaKeys.has(normalizeKey(row[column])) ? total + 1 : total
    ), 0);
    scores.set(column, score);
  });
  const candidates = header.filter((column) => {
    const score = scores.get(column) ?? 0;
    return score >= threshold && score > 0;
  });
  if (candidates.length === 0) {
    return { joinColumn: null, candidates: [] };
  }
  // Header order gives leftmost-on-tie: only replace on a strictly greater score.
  let joinColumn = candidates[0];
  candidates.forEach((column) => {
    if ((scores.get(column) ?? 0) > (scores.get(joinColumn) ?? 0)) {
      joinColumn = column;
    }
  });
  return { joinColumn, candidates };
}

type JoinResult = { joinColumn: string | null; candidates: string[] };

// Some exporters prefix the real header with `#`; accept that row only when it lines up with the
// first data row and joins the media keys.
function selectHeaderAndRows(
  rawRows: string[][],
  normalizedMediaKeys: Set<string>,
): { header: string[]; rows: FrameMetadataRow[]; join: JoinResult | null } {
  const { commentBlock, body } = splitCommentBlock(rawRows);
  if (body.length === 0) {
    return { header: [], rows: [], join: null };
  }

  if (commentBlock.length > 0) {
    const candidateCells = stripCommentMarker(commentBlock[commentBlock.length - 1]);
    if (candidateCells.length === body[0].length) {
      const { header, rows } = buildTable(candidateCells, body);
      if (header.length > 0 && rows.length > 0) {
        const join = selectJoinColumn(header, rows, normalizedMediaKeys);
        if (join.joinColumn !== null) {
          const firstKey = normalizeKey(rows[0][join.joinColumn] || '');
          if (normalizedMediaKeys.has(firstKey)) {
            return { header, rows, join };
          }
        }
      }
    }
  }

  const { header, rows } = buildTable(body[0], body.slice(1));
  return { header, rows, join: null };
}

function parseFrameMetadataSource(
  text: string,
  mediaIndex: MediaKeyIndex | MediaKeys,
  sourceName?: string,
): ParsedFrameMetadata | null {
  // Accept a prebuilt index so the read path can reuse the resolver's normalized media keys.
  const index = isMediaKeyIndex(mediaIndex) ? mediaIndex : normalizeMediaKeys(mediaIndex);
  const normalizedMediaKeys = index.normalizedKeys;

  // NUL bytes mark a binary/corrupt file, not telemetry.
  if (text.indexOf('\0') !== -1) {
    return null;
  }
  // Strip a leading UTF-8 BOM explicitly so the intent is not hidden inside trim().
  const content = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;

  const rawRows = readRows(content);
  if (rawRows.length === 0) {
    return null;
  }

  const { header, rows, join: threadedJoin } = selectHeaderAndRows(rawRows, normalizedMediaKeys);
  if (header.length === 0 || rows.length === 0) {
    return null;
  }

  const { joinColumn, candidates } = threadedJoin
    ?? selectJoinColumn(header, rows, normalizedMediaKeys);
  if (joinColumn === null) {
    return null;
  }

  const payloadColumns = header.filter((column) => !candidates.includes(column));
  if (payloadColumns.length === 0) {
    return null;
  }

  // Additional matching image columns identify other cameras and should not appear as payload.
  const excluded = new Set(candidates.filter((column) => column !== joinColumn));
  const recordFields = header.filter((column) => !excluded.has(column));

  // Null-prototype so a "__proto__" media key becomes an own record entry and so
  // `key in records` below reflects only records we have actually populated.
  const records: Record<string, FrameMetadataRow> = Object.create(null);
  rows.forEach((row) => {
    const key = normalizeKey(row[joinColumn] || '');
    // First row claiming an image wins; `in` works on null-prototype objects.
    if (normalizedMediaKeys.has(key) && !(key in records)) {
      const record: FrameMetadataRow = Object.create(null);
      recordFields.forEach((field) => {
        record[field] = row[field] || '';
      });
      records[key] = record;
    }
  });

  if (Object.keys(records).length === 0) {
    return null;
  }

  return { sourceName, columns: recordFields, records };
}

function readRows(text: string): string[][] {
  const sniff = sniffLine(text);
  if (sniff === null) {
    return [];
  }

  const delimiter = sniffDelimiter(sniff);
  if (delimiter === null) {
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => line.trim().split(/\s+/));
  }

  try {
    // Drop delimiter-only rows before header selection; otherwise `,,,` becomes the header.
    return parseDelimited(text, delimiter).filter((row) => row.some((cell) => cell.length > 0));
  } catch {
    // NUL bytes, oversized fields, etc. are treated as "not a telemetry source" instead of
    // surfacing a parse error.
    return [];
  }
}

// Keep tokenization local because this file must bundle in the browser. The parser is lenient
// with bare quotes because field logs commonly contain units such as `5"`.
function tokenizeDelimited(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // A quote opens a quoted field only at the very start of a field (before any char is read).
  let fieldStart = true;
  // Whether the current record has any content, so a trailing newline does not emit an empty row.
  let rowHasContent = false;
  const endField = () => {
    row.push(field);
    field = '';
    fieldStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    rowHasContent = false;
  };
  const { length } = text;
  let i = 0;
  while (i < length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      rowHasContent = true;
      i += 1;
    } else if (ch === delimiter) {
      rowHasContent = true;
      endField();
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      endRow();
      i += 1;
    } else {
      field += ch;
      fieldStart = false;
      rowHasContent = true;
      i += 1;
    }
  }
  // Flush a final record only when the last line had no trailing newline.
  if (rowHasContent || field.length > 0 || row.length > 0) {
    endField();
    rows.push(row);
  }
  return rows;
}

function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
  if (text.indexOf('\0') !== -1) {
    // A NUL byte marks a binary/corrupt file; throw so the guard in readRows treats
    // NUL-poisoned input as non-telemetry.
    throw new Error('line contains NUL');
  }
  const rows = tokenizeDelimited(text, delimiter);
  // Enforce the limit per field, matching Python csv behavior, before trimming cells.
  if (rows.some((row) => row.some((cell) => cell.length > FIELD_SIZE_LIMIT))) {
    throw new Error('field larger than the size limit');
  }
  return rows.map((row) => row.map((cell) => cell.trim()));
}

// Ignore leading prose comments while sniffing so commas inside prose do not override TSV data.
function sniffLine(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.find((line) => !line.startsWith('#')) ?? lines[0] ?? null;
}

function sniffDelimiter(line: string): ',' | '\t' | null {
  // Count-based so a tab-delimited header whose field names contain commas
  // (e.g. a parenthesized unit like "Position (lat, lon)") still sniffs as TSV.
  const commas = line.split(',').length - 1;
  const tabs = line.split('\t').length - 1;
  if (tabs > commas) {
    return '\t';
  }
  if (commas > 0) {
    return ',';
  }
  return null;
}

export {
  FrameMetadataRow,
  MediaKeyIndex,
  MediaKeys,
  ParsedFrameMetadata,
  normalizeKey,
  parseFrameMetadataSource,
};
