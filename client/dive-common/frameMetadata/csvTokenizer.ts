export type DelimitedTableDelimiter = ',' | '\t';

// Keep tokenization node-free because frame metadata parsing runs in both Electron and the browser
// renderer. The parser is lenient with bare quotes because field logs commonly contain units such
// as `5"`. Cells are trimmed here so every consumer sees one canonical cell value.
export function parseDelimitedRows(text: string, delimiter: DelimitedTableDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotedField = false;
  let atFieldStart = true;
  let rowHasContent = false;
  const endField = () => {
    row.push(field.trim());
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
