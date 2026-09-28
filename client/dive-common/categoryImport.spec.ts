import { parseCategoryFile } from './categoryImport';

const parseJson = (value: unknown) => parseCategoryFile(JSON.stringify(value), 'categories.json');

describe('category file import', () => {
  it('imports COCO categories without importing annotations and preserves hierarchy-only parents', () => {
    expect(parseJson({
      categories: [{
        id: 2, name: 'salmon', supercategory: 'fish', parents: ['ignored'],
      }],
      annotations: [{ category_id: 2 }],
    })).toEqual({ types: ['salmon'], typeHierarchy: { salmon: 'fish' }, warnings: [] });
  });

  it('accepts COCO top-level self supercategories and null supercategories', () => {
    expect(parseJson({
      categories: [
        { name: 'fish', supercategory: 'fish' },
        { name: 'animal', supercategory: null },
        { name: 'shark', supercategory: 'fish' },
      ],
    })).toEqual({ types: ['fish', 'animal', 'shark'], typeHierarchy: { shark: 'fish' }, warnings: [] });
  });

  it('supports JSON strings, category objects, parents, and DIVE hierarchy maps', () => {
    expect(parseJson(['fish', 'shark', 'fish']).types).toEqual(['fish', 'shark']);
    expect(parseJson({ categories: [{ name: 'shark', parents: ['fish'] }], typeHierarchy: { fish: 'animal' } }))
      .toEqual({ types: ['shark'], typeHierarchy: { shark: 'fish', fish: 'animal' }, warnings: [] });
    expect(parseJson({ typeHierarchy: { fish: 'animal' } }).typeHierarchy).toEqual({ fish: 'animal' });
  });

  it('reads VIAME TXT comments, quoted names, synonyms, BOM, CRLF, and parent references', () => {
    const result = parseCategoryFile('\uFEFF# labels\r\n"sea life" marine\r\n"red fish" rf :parent=marine # comment\r\nshark :parent="sea life"', 'LABELS.TXT');
    expect(result.types).toEqual(['sea life', 'red fish', 'shark']);
    expect(result.typeHierarchy).toEqual({ 'red fish': 'sea life', shark: 'sea life' });
    expect(result.warnings).toHaveLength(1);
  });

  it('reads VIAME CSV quoted commas, escaped quotes, newlines, and multiword names', () => {
    const result = parseCategoryFile('sea life,marine\r\n"fish, red",rf,:parent=marine\r\n"a ""quoted"" fish",,:parent=sea life\n"multi\nline"', 'labels.csv');
    expect(result.types).toEqual(['sea life', 'fish, red', 'a "quoted" fish', 'multi\nline']);
    expect(result.typeHierarchy).toEqual({ 'fish, red': 'sea life', 'a "quoted" fish': 'sea life' });
  });

  it('supports escaped TXT quotes and single quotes', () => {
    expect(parseCategoryFile("'fish species'\n\"a \\\"fish\\\"\"", 'labels.txt').types)
      .toEqual(['fish species', 'a "fish"']);
  });

  it('resolves JSON synonyms without creating extra types', () => {
    const result = parseJson([{ name: 'fish', synonyms: ['f'] }, { name: 'shark', parents: ['f'] }]);
    expect(result.types).toEqual(['fish', 'shark']);
    expect(result.typeHierarchy).toEqual({ shark: 'fish' });
    expect(result.warnings).toHaveLength(1);
  });

  it.each([
    {}, { categories: {} }, { categories: null, typeHierarchy: { fish: 'animal' } }, { categories: [1] }, { categories: [{ name: ' ' }] },
    { categories: [{ name: 'fish', id: '1' }] },
    { categories: [{ name: 'fish', parents: 'animal' }] },
    { categories: [{ name: 'fish', synonyms: 'f' }] },
    { categories: [{ name: 'fish', supercategory: 4 }] },
    { typeHierarchy: [] }, { typeHierarchy: { fish: 2 } },
  ])('rejects malformed JSON definitions: %j', (value) => {
    expect(() => parseJson(value)).toThrow();
  });

  it.each([
    { categories: [{ name: 'fish', parents: ['a', 'b'] }] },
    { categories: [{ name: 'fish', supercategory: 'a' }], typeHierarchy: { fish: 'b' } },
    { typeHierarchy: { a: 'b', b: 'a' } },
    { typeHierarchy: { a: 'a' } },
    [{ name: 'fish', synonyms: ['shark'] }, 'shark'],
    [{ name: 'fish', synonyms: ['f'] }, { name: 'shark', synonyms: ['f'] }],
  ])('rejects ambiguous or invalid relationships: %j', (value) => {
    expect(() => parseJson(value)).toThrow();
  });

  it.each([
    ['"unterminated', 'txt'], ['"unterminated', 'csv'],
    ['"fish"x', 'csv'], [',fish', 'csv'], ['fish :parent=', 'txt'],
    ['# only comments', 'txt'], ['', 'csv'], ['[]', 'json'], ['{', 'json'], ['fish', 'xml'],
  ])('rejects invalid or empty files (%s, %s)', (text, extension) => {
    expect(() => parseCategoryFile(text, `labels.${extension}`)).toThrow();
  });

  it('handles prototype property names safely', () => {
    const result = parseJson(JSON.parse('{"typeHierarchy":{"__proto__":"constructor"}}'));
    expect(Object.entries(result.typeHierarchy!)).toEqual([['__proto__', 'constructor']]);
  });
});
