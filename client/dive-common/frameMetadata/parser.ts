import { basicImageFileExtensions, largeImageFileExtensions } from 'dive-common/constants';

// The single frame-metadata parser, shared by the desktop backend and the web client. It is
// deliberately node-free (no `crypto`, no `path`, no `csv-parse`) so the exact same code that
// runs in the Electron backend also bundles and runs in the browser renderer. The conformance
// corpus (testdata/frame-metadata-conformance) is the referee: every fixture must parse
// identically here. The Contract-tag comments document the one implementation.

type FrameMetadataRow = Record<string, string>;
type MediaKeys = Map<string, number> | Record<string, number>;

interface ParsedFrameMetadata {
  sourceName?: string;
  // Payload column names in header (file) order, including the join column and excluding the
  // non-join image candidates. The resolver keeps this order so numeric-named headers render in
  // file order rather than JS object-key order (readtime deferred finding #8).
  columns: string[];
  // Records keyed by normalized media key; each record is a null-prototype {field: value} map.
  records: Record<string, FrameMetadataRow>;
}

// Contract KEY-INDEX: media keys normalized exactly once per camera. Built by the resolver
// (buildMediaKeyIndex) or, for a raw call site, normalized here from a MediaKeys mapping.
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

// Contract P-FIELD: Python's csv.field_size_limit() default. Enforced per *field* (see
// parseDelimited) so a source with any single oversized cell parses to null, while a wide row of
// mid-size cells is accepted.
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

// Normalize a raw media-key mapping to the shared index. The public resolver keeps the ordered
// last-wins builder (buildMediaKeyIndex in resolve.ts); this internal form serves the corpus and
// import call sites that already hold a keyed map.
function normalizeMediaKeys(mediaKeys: MediaKeys): MediaKeyIndex {
  const entries = mediaKeys instanceof Map
    ? Array.from(mediaKeys.entries())
    : Object.entries(mediaKeys);
  const normalizedKeys = new Set<string>();
  const frameByKey = new Map<string, number>();
  entries.forEach(([name, frame]) => {
    const key = normalizeKey(name);
    normalizedKeys.add(key);
    // Last-wins on a normalized-key collision, matching the read path's map build.
    frameByKey.set(key, frame);
  });
  return { normalizedKeys, frameByKey };
}

function isMediaKeyIndex(value: MediaKeyIndex | MediaKeys): value is MediaKeyIndex {
  return !(value instanceof Map) && (value as MediaKeyIndex).normalizedKeys instanceof Set;
}

// Contract P-HDR: split off the leading comment block (consecutive rows whose first cell
// starts with `#`) from the rest of the table.
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

// Contract P-JOIN: score each column by how many rows join the media keys; the join
// candidates clear min(2, rowCount) and the join column is the argmax by score
// (tie -> leftmost).
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

// Contract P-HDR: pick the header, honouring a leading `#` header line only when it
// lines up with the first data line and yields a working join column.
//
// When the `#` header is accepted, the join it was validated with is returned so the caller
// reuses it instead of re-scoring the same rows (Contract P-JOIN threading); a body-path
// header returns `null` for the join, so the caller scores it itself.
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
  // Accept either a prebuilt MediaKeyIndex or a raw media-key mapping (normalized here),
  // so read and import call sites can share the resolver's index (Contract KEY-INDEX)
  // without re-normalizing when they already hold one.
  const index = isMediaKeyIndex(mediaIndex) ? mediaIndex : normalizeMediaKeys(mediaIndex);
  const normalizedMediaKeys = index.normalizedKeys;

  // Contract P-4: NUL bytes mark a binary/corrupt file, not telemetry. Check before
  // parsing so the answer is identical on both platforms.
  if (text.indexOf('\0') !== -1) {
    return null;
  }
  // Contract P-3: strip a leading UTF-8 BOM (U+FEFF) so the header cell is `filename`,
  // not a BOM-prefixed `filename`. String.trim() already drops it, but strip it
  // explicitly so the intent is visible.
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

  // A second matching image column is a join candidate but not the join column, so it is
  // neither joined on nor shown as payload (Contract P-JOIN).
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
    // Contract P-EMPTYROW: an all-empty row (`,,,`) is not skipped by the tokenizer, so drop
    // all-empty rows here (cells are already trimmed) before header selection.
    return parseDelimited(text, delimiter).filter((row) => row.some((cell) => cell.length > 0));
  } catch {
    // NUL bytes, oversized fields, etc. are treated as "not a telemetry source" instead of
    // surfacing a parse error.
    return [];
  }
}

// Contract P-TOKENIZE: a small RFC4180-style delimiter tokenizer (no node `csv-parse`). A quote
// only opens a quoted field when it is the first character of a field, so a bare quote inside an
// unquoted cell (e.g. depth `5"`) is a literal character rather than a parse error (the lenient
// behaviour telemetry sidecars rely on). Inside a quoted field, `""` is an escaped quote and a
// lone `"` closes it. Rows have variable column counts; empty lines become an all-empty row and
// are dropped by the Contract P-EMPTYROW filter in readRows.
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
  // Contract P-FIELD: enforce Python's per-*field* csv.field_size_limit default on the untrimmed
  // cells, so a single oversized cell rejects the source while a wide row of mid-size cells is
  // accepted. Throw so the guard in readRows treats an oversized cell as non-telemetry.
  if (rows.some((row) => row.some((cell) => cell.length > FIELD_SIZE_LIMIT))) {
    throw new Error('field larger than the size limit');
  }
  return rows.map((row) => row.map((cell) => cell.trim()));
}

// Contract P-SNIFF: the delimiter is sniffed from the first non-empty line that does not
// start with `#` (the real data/header line), falling back to the first non-empty line when
// every non-empty line is a comment.
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
