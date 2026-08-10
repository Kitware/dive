import { parseDelimitedRows } from './csvTokenizer';
import type { DelimitedTableDelimiter } from './csvTokenizer';

// Shared by the desktop backend and the web client. Keep this node-free so the same parser runs
// in Electron and in the browser renderer.

/** One row of cells, positionally aligned with `FrameMetadataTable.header`. */
export type FrameMetadataRow = string[];

export interface FrameMetadataTable {
  /**
   * Column names in file order. A repeated name is kept as its own column: rows are positional,
   * so consumers must address cells by index rather than by name.
   */
  header: string[];
  rows: FrameMetadataRow[];
}

function dropLeadingCommentRows(rawRows: string[][]): string[][] {
  let index = 0;
  while (index < rawRows.length && rawRows[index].length > 0 && rawRows[index][0].startsWith('#')) {
    index += 1;
  }
  return rawRows.slice(index);
}

function buildTable(headerCells: string[], dataRows: string[][]): FrameMetadataTable {
  // Empty header cells usually come from pandas indexes or trailing commas. Short rows are padded
  // to the header width here, so joins can address a cell by index without a fallback.
  const keptIndices = headerCells
    .map((cell, index) => (cell.length > 0 ? index : -1))
    .filter((index) => index >= 0);
  if (keptIndices.length === 0) {
    return { header: [], rows: [] };
  }
  return {
    header: keptIndices.map((index) => headerCells[index]),
    rows: dataRows
      .filter((row) => row.some((cell) => cell.length > 0))
      .map((row) => keptIndices.map((index) => row[index] ?? '')),
  };
}

export function parseFrameMetadataTable(text: string): FrameMetadataTable | null {
  if (text.includes('\0')) {
    return null;
  }
  const content = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const rawRows = readRows(content);
  if (rawRows.length === 0) {
    return null;
  }

  const body = dropLeadingCommentRows(rawRows);
  if (body.length === 0) {
    return null;
  }
  const table = buildTable(body[0], body.slice(1));
  return table.header.length > 0 && table.rows.length > 0 ? table : null;
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

  // Drop delimiter-only rows before header selection; otherwise `,,,` becomes the header.
  return parseDelimitedRows(text, delimiter).filter((row) => row.some((cell) => cell.length > 0));
}

// Ignore leading prose comments while sniffing so commas inside prose do not override TSV data.
function sniffLine(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.find((line) => !line.startsWith('#')) ?? lines[0] ?? null;
}

// Only delimiters outside quoted cells vote: a quoted header cell such as `"Position (lat, lon)"`
// contains a comma but does not make the line comma-separated. Cell starts are delimiter-agnostic
// (start of line, or just past a comma or tab) because the delimiter is what we are sniffing for.
function countUnquotedDelimiters(line: string): { commas: number; tabs: number } {
  let commas = 0;
  let tabs = 0;
  let inQuotedCell = false;
  let atCellStart = true;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotedCell) {
      if (ch === '"' && line[i + 1] === '"') {
        i += 1;
      } else if (ch === '"') {
        inQuotedCell = false;
      }
    } else if (ch === '"' && atCellStart) {
      inQuotedCell = true;
      atCellStart = false;
    } else if (ch === ',') {
      commas += 1;
      atCellStart = true;
    } else if (ch === '\t') {
      tabs += 1;
      atCellStart = true;
    } else {
      atCellStart = false;
    }
    i += 1;
  }
  return { commas, tabs };
}

// Tabs win a tie because the two ways to lose are not equally likely, not because a stray tab is
// harmless: cells are only edge-trimmed, so an interior tab does survive tokenization. An unquoted
// TSV header routinely carries commas inside field names (`Pos (lat, lon)\tVel (x, y)\tdepth`
// ties 2-2 and must sniff as TSV), whereas a literal tab inside a CSV header name is vanishingly
// rare. `Pos<TAB>lon,depth` is the case this rule gets wrong, and it is the cheaper one to lose.
function sniffDelimiter(line: string): DelimitedTableDelimiter | null {
  const { commas, tabs } = countUnquotedDelimiters(line);
  if (tabs > 0 && tabs >= commas) {
    return '\t';
  }
  return commas > 0 ? ',' : null;
}
