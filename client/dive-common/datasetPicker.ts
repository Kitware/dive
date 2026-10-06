/**
 * Rows and filtering behind the shared dataset picker, kept free of Vue so
 * the search and type-filter behaviour is testable and identical on every page.
 */

/** A dataset offered for selection; any extra fields can feed extra table columns. */
export interface DatasetPickerRow {
  id: string;
  name: string;
  type?: string;
}

/**
 * Rows matching an optional type equality filter and an optional substring
 * search across the listed fields (both case-insensitive, whitespace-trimmed).
 * Search defaults to the name only; type is narrowed separately via typeFilter.
 * Empty / null filters keep everything for that criterion.
 */
export function filterDatasetRows<T extends DatasetPickerRow>(
  rows: readonly T[],
  search: string | null | undefined = '',
  fields: readonly string[] = ['name'],
  typeFilter: string | null | undefined = null,
): T[] {
  const typeNeedle = (typeFilter ?? '').trim().toLowerCase();
  const searchNeedle = (search ?? '').trim().toLowerCase();
  if (!typeNeedle && !searchNeedle) return [...rows];
  return rows.filter((row) => {
    if (typeNeedle && (row.type ?? '').toLowerCase() !== typeNeedle) {
      return false;
    }
    if (!searchNeedle) return true;
    return fields.some((field) => {
      const value = (row as unknown as Record<string, unknown>)[field];
      return value !== undefined && value !== null && String(value).toLowerCase().includes(searchNeedle);
    });
  });
}

/** Distinct type values present in the rows, sorted for a stable select list. */
export function datasetTypeOptions<T extends DatasetPickerRow>(
  rows: readonly T[],
): string[] {
  const types = new Set<string>();
  rows.forEach((row) => {
    if (row.type) types.add(row.type);
  });
  return [...types].sort((a, b) => a.localeCompare(b));
}

/** Ids of the listed rows not yet selected: what "select all" adds. */
export function selectableIds<T extends DatasetPickerRow>(
  rows: readonly T[],
  selectedIds: readonly string[],
): string[] {
  const selected = new Set(selectedIds);
  return rows.filter((row) => !selected.has(row.id)).map((row) => row.id);
}
