import type { TaxonomySources } from './worms';
import { normalizeTypeHierarchy, TypeHierarchy } from './typeHierarchy';

export interface CategoryImport {
  types: string[];
  taxonomySources?: TaxonomySources;
  typeHierarchy?: TypeHierarchy;
  warnings: string[];
}

function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Category names and parents must be nonempty strings.');
  }
  return value;
}

/** Match VIAME's label rows: TXT uses whitespace, CSV uses commas, extras are aliases. */
function labelRows(text: string, csv: boolean): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quote = '';
  let started = false;
  let closed = false;
  let quoted = false;
  const finishField = () => {
    if (csv && !quoted) field = field.replace(/[ \t]+$/, '');
    if (started) row.push(label(field));
    field = '';
    started = false;
    closed = false;
    quoted = false;
  };
  const finishRow = () => {
    finishField();
    if (row.length) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        if (text[i + 1] === quote) {
          field += c;
          i += 1;
        } else {
          quote = '';
          closed = true;
        }
      } else if (!csv && c === '\\' && [quote, '\\'].includes(text[i + 1])) {
        i += 1;
        field += text[i];
      } else {
        if (!csv && /[\r\n]/.test(c)) throw new Error('Unterminated quoted label.');
        field += c;
      }
    } else if (/[\r\n]/.test(c)) {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      finishRow();
    } else if (!csv && c === '#') {
      while (i + 1 < text.length && !/[\r\n]/.test(text[i + 1])) i += 1;
      finishRow();
    } else if (csv && c === ',') {
      if (!started && !row.length) throw new Error('Empty category name.');
      finishField();
    } else if (/\s/.test(c)) {
      if (!csv) finishField();
      else if (started && !closed) field += c;
    } else if ((c === '"' || (!csv && c === "'"))
      && (!started || (!csv && field === ':parent='))) {
      quote = c;
      started = true;
      quoted = true;
    } else {
      if (closed) throw new Error('Expected a separator after quoted label.');
      field += c;
      started = true;
    }
  }
  if (quote) throw new Error('Unterminated quoted label.');
  finishRow();
  return rows;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse category definitions only; COCO images and annotations are deliberately ignored. */
export function parseCategoryFile(contents: string, filename: string): CategoryImport {
  const text = contents.replace(/^\uFEFF/, '');
  const extension = filename.split('.').pop()?.toLowerCase();
  const names = new Set<string>();
  const aliases = new Map<string, string>();
  const edges: [string, string][] = [];
  const addAlias = (name: string, value: unknown) => {
    const alias = label(value);
    if (aliases.has(alias) && aliases.get(alias) !== name) {
      throw new Error(`Synonym "${alias}" refers to multiple categories.`);
    }
    aliases.set(alias, name);
  };
  const addName = (value: unknown) => {
    const name = label(value);
    names.add(name);
    return name;
  };
  if (extension === 'json') {
    const doc: unknown = JSON.parse(text);
    let categories: unknown = doc;
    if (isObject(doc)) {
      categories = Object.prototype.hasOwnProperty.call(doc, 'typeHierarchy') ? [] : undefined;
      if (Object.prototype.hasOwnProperty.call(doc, 'categories')) categories = doc.categories;
    }
    if (!Array.isArray(categories)) {
      throw new Error('JSON must be a category array or contain categories or typeHierarchy.');
    }
    categories.forEach((category: unknown) => {
      const name = addName(isObject(category) ? category.name : category);
      if (!isObject(category)) return;
      if (category.id !== undefined && !Number.isInteger(category.id)) {
        throw new Error(`Category id for "${name}" must be an integer.`);
      }
      if (category.synonyms !== undefined) {
        if (!Array.isArray(category.synonyms)) throw new Error('synonyms must be an array.');
        category.synonyms.forEach((alias) => addAlias(name, alias));
      }
      if (category.supercategory !== undefined && category.supercategory !== null
        && typeof category.supercategory !== 'string') {
        throw new Error('supercategory must be a string.');
      }
      if (category.supercategory) {
        // COCO often repeats the category name to designate a top-level category.
        if (category.supercategory !== name) edges.push([name, label(category.supercategory)]);
      } else if (category.parents !== undefined) {
        if (!Array.isArray(category.parents)) throw new Error('parents must be an array.');
        category.parents.forEach((parent) => edges.push([name, label(parent)]));
      }
    });
    if (isObject(doc) && doc.typeHierarchy !== undefined && doc.typeHierarchy !== null) {
      if (!isObject(doc.typeHierarchy)) throw new Error('typeHierarchy must be a child-to-parent object.');
      Object.entries(doc.typeHierarchy).forEach(([child, parent]) => {
        edges.push([label(child), label(parent)]);
      });
    }
  } else if (extension === 'txt' || extension === 'csv') {
    labelRows(text, extension === 'csv').forEach(([value, ...extras]) => {
      const name = addName(value);
      extras.forEach((extra) => {
        if (extra.startsWith(':parent=')) edges.push([name, label(extra.slice(8))]);
        else addAlias(name, extra);
      });
    });
  } else {
    throw new Error('Choose a .txt, .csv, or .json category file.');
  }
  aliases.forEach((name, alias) => {
    if (names.has(alias) && alias !== name) {
      throw new Error(`Synonym "${alias}" is also a category name.`);
    }
  });
  const hierarchy = new Map<string, string>();
  edges.forEach(([rawChild, rawParent]) => {
    const child = aliases.get(rawChild) ?? rawChild;
    const parent = aliases.get(rawParent) ?? rawParent;
    if (hierarchy.has(child) && hierarchy.get(child) !== parent) {
      throw new Error(`Category "${child}" has multiple parents. DIVE supports one parent per type.`);
    }
    hierarchy.set(child, parent);
  });
  const typeHierarchy = normalizeTypeHierarchy(Object.fromEntries(hierarchy));
  if (!names.size && !hierarchy.size) throw new Error('The file contains no categories.');
  return {
    types: [...names],
    typeHierarchy,
    warnings: aliases.size
      ? ['Synonyms resolve parent references during import. DIVE stores canonical category names, not synonym aliases.']
      : [],
  };
}
