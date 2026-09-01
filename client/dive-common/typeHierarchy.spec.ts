import fs from 'fs-extra';
import {
  acceptPairAsCorrect,
  compareTypeNames,
  compileHierarchy,
  mergePairs,
  normalizeTypeHierarchy,
  reassignPairs,
  removeHierarchyType,
  removePair,
  resolveConfidenceThreshold,
  resolveTypeHierarchy,
  rewriteHierarchyType,
  selectFlatPairIndex,
  selectPairIndex,
  setHierarchyParent,
  setPairConfidence,
  TypeHierarchyError,
  updateHierarchyTypeDefinition,
} from './typeHierarchy';

interface ErrorExpectation {
  errorReason: string | null;
  errorKind: 'malformed' | 'conflict' | null;
}

interface NormalizationCase extends ErrorExpectation {
  name: string;
  input: unknown;
  expected: Record<string, string> | null;
}

interface ResolutionCase extends ErrorExpectation {
  name: string;
  existing: unknown;
  incomingPresent: boolean;
  incoming?: unknown;
  mode: 'save' | 'overwrite' | 'additive';
  expectedAction: 'none' | 'delete' | 'set' | null;
  expected?: Record<string, string>;
}

interface RenameCase extends ErrorExpectation {
  name: string;
  hierarchy: Record<string, string>;
  currentType: string;
  newType: string;
  expected: Record<string, string> | null;
}

interface SelectionCase {
  name: string;
  hierarchy: Record<string, string>;
  pairs: [string, number][];
  passes: boolean[];
  expectedIndex: number;
}

interface ReassignmentCase {
  name: string;
  hierarchy: Record<string, string>;
  pairs: [string, number][];
  replaceType: string;
  newType: string;
  confidence: number;
  expected: [string, number][];
}

interface AcceptanceCase {
  name: string;
  hierarchy: Record<string, string>;
  pairs: [string, number][];
  acceptedType: string;
  expected: [string, number][];
}

interface PairConfidenceCase {
  name: string;
  pairs: [string, number][];
  type: string;
  confidence: number;
  expected: [string, number][];
}

interface PairRemovalCase {
  name: string;
  pairs: [string, number][];
  type: string;
  expected: [string, number][];
}

interface TypeHierarchyCorpus {
  normalizationCases: NormalizationCase[];
  resolutionCases: ResolutionCase[];
  renameCases: RenameCase[];
  selectionCases: SelectionCase[];
  reassignmentCases: ReassignmentCase[];
  acceptanceCases: AcceptanceCase[];
  pairConfidenceCases: PairConfidenceCase[];
  pairRemovalCases: PairRemovalCase[];
}

const corpus = fs.readJSONSync('../testutils/typeHierarchy.spec.json') as TypeHierarchyCorpus;

function expectHierarchyError(
  callback: () => unknown,
  expectedReason: string,
  expectedKind: 'malformed' | 'conflict',
) {
  try {
    callback();
    throw new Error('Expected TypeHierarchyError');
  } catch (error) {
    expect(error).toBeInstanceOf(TypeHierarchyError);
    expect((error as TypeHierarchyError).reason).toBe(expectedReason);
    expect((error as TypeHierarchyError).kind).toBe(expectedKind);
    expect((error as TypeHierarchyError).message).toBe(expectedReason);
  }
}

describe('shared type hierarchy corpus', () => {
  describe.each(corpus.normalizationCases)('normalization: $name', (testCase) => {
    it('matches the shared result', () => {
      if (testCase.errorReason !== null && testCase.errorKind !== null) {
        expectHierarchyError(
          () => normalizeTypeHierarchy(testCase.input),
          testCase.errorReason,
          testCase.errorKind,
        );
      } else {
        expect(normalizeTypeHierarchy(testCase.input)).toEqual(testCase.expected || undefined);
      }
    });
  });

  describe.each(corpus.resolutionCases)('resolution: $name', (testCase) => {
    it('matches the shared result', () => {
      const resolve = () => resolveTypeHierarchy(
        testCase.existing,
        testCase.incomingPresent,
        testCase.incoming,
        testCase.mode,
      );
      if (testCase.errorReason !== null && testCase.errorKind !== null) {
        expectHierarchyError(resolve, testCase.errorReason, testCase.errorKind);
      } else {
        const write = resolve();
        expect(write.action).toBe(testCase.expectedAction);
        if (write.action === 'set') {
          expect(write.hierarchy).toEqual(testCase.expected);
        } else {
          expect('hierarchy' in write).toBe(false);
        }
      }
    });
  });

  describe.each(corpus.renameCases)('rename: $name', (testCase) => {
    it('matches the shared result', () => {
      const rewrite = () => rewriteHierarchyType(
        testCase.hierarchy,
        testCase.currentType,
        testCase.newType,
      );
      if (testCase.errorReason !== null && testCase.errorKind !== null) {
        expectHierarchyError(rewrite, testCase.errorReason, testCase.errorKind);
      } else {
        expect(rewrite()).toEqual(testCase.expected || undefined);
      }
    });
  });

  describe.each(corpus.selectionCases)('selection: $name', (testCase) => {
    it('matches the shared result', () => {
      const hierarchy = normalizeTypeHierarchy(testCase.hierarchy) || {};
      expect(selectPairIndex(
        compileHierarchy(hierarchy),
        testCase.pairs,
        testCase.passes,
      )).toBe(testCase.expectedIndex);
    });
  });

  describe.each(corpus.reassignmentCases)('reassignment: $name', (testCase) => {
    it('matches the shared result', () => {
      const hierarchy = normalizeTypeHierarchy(testCase.hierarchy) || {};
      expect(reassignPairs(
        compileHierarchy(hierarchy),
        testCase.pairs,
        testCase.replaceType,
        testCase.newType,
        testCase.confidence,
      )).toEqual(testCase.expected);
    });
  });

  describe.each(corpus.acceptanceCases)('acceptance: $name', (testCase) => {
    it('matches the shared result', () => {
      const hierarchy = normalizeTypeHierarchy(testCase.hierarchy) || {};
      expect(acceptPairAsCorrect(
        compileHierarchy(hierarchy),
        testCase.pairs,
        testCase.acceptedType,
      )).toEqual(testCase.expected);
    });
  });

  describe.each(corpus.pairConfidenceCases)('pair confidence: $name', (testCase) => {
    it('matches the shared result', () => {
      expect(setPairConfidence(
        testCase.pairs,
        testCase.type,
        testCase.confidence,
      )).toEqual(testCase.expected);
    });
  });

  describe.each(corpus.pairRemovalCases)('pair removal: $name', (testCase) => {
    it('matches the shared result', () => {
      expect(removePair(testCase.pairs, testCase.type)).toEqual(testCase.expected);
    });
  });
});

describe('type hierarchy index', () => {
  const hierarchy = normalizeTypeHierarchy({ cod: 'fish', fish: 'animal' }) || {};
  const index = compileHierarchy(hierarchy);

  it('normalizes into a fresh map', () => {
    const input = { cod: 'fish' };
    expect(normalizeTypeHierarchy(input)).not.toBe(input);
  });

  it('rejects pair/pass length mismatches', () => {
    expect(() => selectPairIndex(index, [['cod', 0.9]], [])).toThrow(
      'passes and pairs must have the same length',
    );
  });

  it('classification operations do not mutate or reuse their input pairs', () => {
    const pairs: [string, number][] = [['cod', 0.8], ['fish', 0.7], ['bird', 0.2]];
    const snapshot = pairs.map(([type, confidence]) => [type, confidence] as [string, number]);
    const results = [
      reassignPairs(index, pairs, 'cod', 'haddock', 0.8),
      acceptPairAsCorrect(index, pairs, 'cod'),
      setPairConfidence(pairs, 'cod', 1.0),
      removePair(pairs, 'bird'),
    ];

    expect(pairs).toEqual(snapshot);
    results.forEach((result) => {
      expect(result).not.toBe(pairs);
      result.forEach((pair) => expect(pairs).not.toContain(pair));
    });
  });
});

describe('hierarchy editing transformations', () => {
  describe('setHierarchyParent', () => {
    it('sets the first edge from an absent hierarchy', () => {
      expect(setHierarchyParent(undefined, 'cod', 'fish')).toEqual({ cod: 'fish' });
    });

    it('reparents a child and clears an edge without disturbing other branches', () => {
      const hierarchy = { cod: 'fish', tern: 'bird' };
      expect(setHierarchyParent(hierarchy, 'cod', 'animal')).toEqual({
        cod: 'animal',
        tern: 'bird',
      });
      expect(setHierarchyParent(hierarchy, 'cod', undefined)).toEqual({ tern: 'bird' });
    });

    it('returns undefined after clearing the final edge', () => {
      expect(setHierarchyParent({ cod: 'fish' }, 'cod', undefined)).toBeUndefined();
    });

    it('rejects blank names, self edges, and cycles', () => {
      expectHierarchyError(
        () => setHierarchyParent(undefined, ' ', 'fish'),
        'empty child',
        'malformed',
      );
      expectHierarchyError(
        () => setHierarchyParent(undefined, 'cod', '\u001c'),
        'empty parent for "cod"',
        'malformed',
      );
      expectHierarchyError(
        () => setHierarchyParent(undefined, 'cod', 'cod'),
        'self edge "cod -> cod"',
        'malformed',
      );
      expectHierarchyError(
        () => setHierarchyParent({ cod: 'fish' }, 'fish', 'cod'),
        'cycle cod -> fish -> cod',
        'malformed',
      );
    });

    it('returns a fresh map without changing its input', () => {
      const hierarchy = Object.freeze({ cod: 'fish', tern: 'bird' });
      const result = setHierarchyParent(hierarchy, 'cod', 'fish');
      expect(result).toEqual(hierarchy);
      expect(result).not.toBe(hierarchy);
      expect(hierarchy).toEqual({ cod: 'fish', tern: 'bird' });
    });

    it('orders keys by code point', () => {
      const bmp = '\uE000';
      const astral = '\u{10000}';
      const result = setHierarchyParent({ [astral]: 'root' }, bmp, 'root');
      expect(compareTypeNames(bmp, astral)).toBeLessThan(0);
      expect(Object.keys(result || {})).toEqual([bmp, astral]);
    });
  });

  describe('removeHierarchyType', () => {
    it('removes a middle node and promotes all of its children', () => {
      expect(removeHierarchyType({
        cod: 'fish',
        haddock: 'fish',
        fish: 'animal',
        tern: 'bird',
      }, 'fish')).toEqual({
        cod: 'animal',
        haddock: 'animal',
        tern: 'bird',
      });
    });

    it('makes children of a removed top-level node top level', () => {
      expect(removeHierarchyType({
        cod: 'fish',
        haddock: 'fish',
        tern: 'bird',
      }, 'fish')).toEqual({ tern: 'bird' });
    });

    it('removes a leaf and returns undefined when the final edge is removed', () => {
      expect(removeHierarchyType({ cod: 'fish', tern: 'bird' }, 'cod'))
        .toEqual({ tern: 'bird' });
      expect(removeHierarchyType({ cod: 'fish' }, 'cod')).toBeUndefined();
    });

    it('normalizes an absent-type no-op into a fresh map', () => {
      const hierarchy = Object.freeze({ cod: 'fish', tern: 'bird' });
      const result = removeHierarchyType(hierarchy, 'shark');
      expect(result).toEqual(hierarchy);
      expect(result).not.toBe(hierarchy);
      expect(hierarchy).toEqual({ cod: 'fish', tern: 'bird' });
    });
  });

  describe('updateHierarchyTypeDefinition', () => {
    it('builds a valid rename and reparent result without validating an invalid intermediate map', () => {
      const hierarchy = {
        cod: 'fish',
        haddock: 'animal',
        sole: 'cod',
        tern: 'bird',
      };
      expect(() => rewriteHierarchyType(hierarchy, 'cod', 'haddock'))
        .toThrow('conflicting parents for "haddock": "animal" and "fish"');

      expect(updateHierarchyTypeDefinition(
        hierarchy,
        'cod',
        'haddock',
        'fish',
      )).toEqual({
        haddock: 'fish',
        sole: 'haddock',
        tern: 'bird',
      });
    });

    it('rewrites child references while applying the final edited parent', () => {
      expect(updateHierarchyTypeDefinition(
        { cod: 'fish', fish: 'animal' },
        'fish',
        'vertebrate',
        'life',
      )).toEqual({ cod: 'vertebrate', vertebrate: 'life' });
    });

    it('validates the complete final map and leaves its input unchanged', () => {
      const hierarchy = Object.freeze({ cod: 'fish', fish: 'animal' });
      expectHierarchyError(
        () => updateHierarchyTypeDefinition(hierarchy, 'fish', 'fish', 'cod'),
        'cycle cod -> fish -> cod',
        'malformed',
      );
      expect(hierarchy).toEqual({ cod: 'fish', fish: 'animal' });
    });

    it('rejects a blank final name even when it would have no edge', () => {
      expectHierarchyError(
        () => updateHierarchyTypeDefinition(undefined, 'cod', ' ', undefined),
        'empty child',
        'malformed',
      );
    });
  });
});

describe('flat pair selection', () => {
  const pairs: [string, number][] = [['top', 0.5], ['fallback', 0.8]];

  it('uses zero when the default threshold is absent', () => {
    expect(selectFlatPairIndex(pairs, {
      checkedSet: new Set(['fallback']),
      confidenceFilters: {},
      filtersDisabled: false,
      preventCascade: false,
    })).toBe(1);
  });

  it('keeps the strict Prevent Cascade threshold comparison', () => {
    expect(selectFlatPairIndex(pairs, {
      checkedSet: new Set(['top', 'fallback']),
      confidenceFilters: { top: 0.5, default: 0.1 },
      filtersDisabled: false,
      preventCascade: true,
    })).toBe(-1);
  });

  it('honors an explicit type threshold of zero the same way export does', () => {
    const filters = { default: 0.1, zero: 0 };
    const stored: [string, number][] = [['zero', 0], ['other', 0.9]];

    expect(resolveConfidenceThreshold(filters, 'zero')).toBe(0);
    expect(selectFlatPairIndex(stored, {
      checkedSet: new Set(['zero']),
      confidenceFilters: filters,
      filtersDisabled: false,
      preventCascade: false,
    })).toBe(0);
  });

  it('lets a type-specific threshold override a higher default', () => {
    expect(selectFlatPairIndex([['fish', 0.4]], {
      checkedSet: new Set(['fish']),
      confidenceFilters: { default: 0.5, fish: 0.3 },
      filtersDisabled: false,
      preventCascade: false,
    })).toBe(0);
  });
});

describe('pair merging', () => {
  const cases: [Array<[string, number][]>, [string, number][]][] = [
    [
      [[['fish', 0.7], ['shark', 1.0]], [['fish', 0.9], ['bird', 0.4]]],
      [['shark', 1.0], ['fish', 0.9], ['bird', 0.4]],
    ],
    [
      [[['bird', 0.4], ['fish', 0.9]], [['shark', 1.0], ['fish', 0.7]]],
      [['shark', 1.0], ['fish', 0.9], ['bird', 0.4]],
    ],
  ];

  it.each(cases)(
    'unions names and keeps the maximum duplicate score independent of input order',
    (inputs, expected) => {
      expect(mergePairs(inputs)).toEqual(expected);
    },
  );

  it('uses deterministic type order for equal scores', () => {
    expect(mergePairs([
      [['tern', 0.8]],
      [['cod', 0.8]],
    ])).toEqual([
      ['cod', 0.8],
      ['tern', 0.8],
    ]);
  });

  it('returns independent arrays and tuples without changing its inputs', () => {
    const first: [string, number][] = [['fish', 0.7]];
    const second: [string, number][] = [['shark', 1.0]];
    const before = [first.map((pair) => [...pair]), second.map((pair) => [...pair])];

    const result = mergePairs([first, second]);

    expect([first, second]).toEqual(before);
    expect(result).not.toBe(first);
    result.forEach((pair) => {
      expect(first).not.toContain(pair);
      expect(second).not.toContain(pair);
    });
  });
});
