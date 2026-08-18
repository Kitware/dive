import fs from 'fs-extra';
import {
  acceptPairAsCorrect,
  compileHierarchy,
  normalizeTypeHierarchy,
  reassignPairs,
  removePair,
  resolveTypeHierarchy,
  rewriteHierarchyType,
  selectPairIndex,
  setPairConfidence,
  TypeHierarchyError,
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
