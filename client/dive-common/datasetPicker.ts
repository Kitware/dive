/**
 * Rows and filtering behind the shared dataset picker, kept free of Vue so
 * the search behaviour is testable and identical on every page.
 */

/** A dataset offered for selection; extra fields feed extra table columns. */
export interface DatasetPickerRow {
  id: string;
  name: string;
  type?: string;
  [column: string]: unknown;
}

/**
 * Rows whose listed fields contain the search text (case-insensitive,
 * whitespace-trimmed). An empty search keeps everything.
 */
export function filterDatasetRows<T extends DatasetPickerRow>(
  rows: readonly T[],
  search: string,
  fields: readonly string[] = ['name', 'type'],
): T[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => fields.some((field) => {
    const value = row[field];
    return value !== undefined && value !== null && String(value).toLowerCase().includes(needle);
  }));
}

/** Ids of the listed rows not yet selected: what "select all" adds. */
export function selectableIds<T extends DatasetPickerRow>(
  rows: readonly T[],
  selectedIds: readonly string[],
): string[] {
  const selected = new Set(selectedIds);
  return rows.filter((row) => !selected.has(row.id)).map((row) => row.id);
}
