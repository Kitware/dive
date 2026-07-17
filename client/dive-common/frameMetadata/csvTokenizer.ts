type DelimitedTableDelimiter = ',' | '\t';

// Match Python's csv.field_size_limit() default so browser and desktop reject pathological cells
// consistently.
const FIELD_SIZE_LIMIT = 131072;

// Keep tokenization node-free because frame metadata parsing runs in both Electron and the browser
// renderer. The parser is lenient with bare quotes because field logs commonly contain units such
// as `5"`.
function scanDelimitedRows(text: string, delimiter: DelimitedTableDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotedField = false;
  let atFieldStart = true;
  let rowHasContent = false;
  const endField = () => {
    row.push(field);
    field = '';
    atFieldStart = true;
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
    if (inQuotedField) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotedField = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"' && atFieldStart) {
      inQuotedField = true;
      atFieldStart = false;
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
      atFieldStart = false;
      rowHasContent = true;
      i += 1;
    }
  }
  if (rowHasContent || field.length > 0 || row.length > 0) {
    endField();
    rows.push(row);
  }
  return rows;
}

function parseDelimitedRows(text: string, delimiter: DelimitedTableDelimiter): string[][] {
  if (text.includes('\0')) {
    throw new Error('line contains NUL');
  }
  const rows = scanDelimitedRows(text, delimiter);
  if (rows.some((row) => row.some((cell) => cell.length > FIELD_SIZE_LIMIT))) {
    throw new Error('field larger than the size limit');
  }
  return rows.map((row) => row.map((cell) => cell.trim()));
}

export {
  parseDelimitedRows,
};

export type {
  DelimitedTableDelimiter,
};
