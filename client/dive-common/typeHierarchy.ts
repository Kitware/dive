export type TypeHierarchy = Readonly<Record<string, string>>;

export type HierarchyWrite =
  | { action: 'none' }
  | { action: 'delete' }
  | { action: 'set'; hierarchy: TypeHierarchy };

export class TypeHierarchyError extends Error {
  readonly reason: string;

  readonly kind: 'malformed' | 'conflict';

  constructor(reason: string, kind: 'malformed' | 'conflict' = 'malformed') {
    super(reason);
    this.name = 'TypeHierarchyError';
    this.reason = reason;
    this.kind = kind;
  }
}

export interface TypeHierarchyIndex {
  hierarchy: TypeHierarchy;
  ancestors: Readonly<Record<string, readonly string[]>>;
}

interface FlatPairSelectionOptions {
  checkedSet: ReadonlySet<string>;
  confidenceFilters: Readonly<Record<string, number>>;
  filtersDisabled: boolean;
  preventCascade: boolean;
}

/** Select the visible classification pair when no hierarchy is active. */
export function selectFlatPairIndex(
  pairs: readonly (readonly [string, number])[],
  {
    checkedSet, confidenceFilters, filtersDisabled, preventCascade,
  }: FlatPairSelectionOptions,
): number {
  if (pairs.length === 0) return -1;
  if (filtersDisabled) return 0;
  const passes = ([type, confidence]: readonly [string, number]) => {
    const threshold = Math.max(
      confidenceFilters[type] || 0,
      confidenceFilters.default || 0,
    );
    return checkedSet.has(type) && confidence >= threshold;
  };
  if (preventCascade) {
    const [type, confidence] = pairs[0];
    const threshold = Math.max(
      confidenceFilters[type] || 0,
      confidenceFilters.default || 0,
    );
    return checkedSet.has(type) && confidence > threshold ? 0 : -1;
  }
  return pairs.findIndex(passes);
}

// Python orders strings by code point; JS compares UTF-16 units, which sorts astral
// names before U+E000-U+FFFF. Compare code points so both platforms agree.
function codePointCompare(left: string, right: string): number {
  const leftPoints = [...left].map((char) => char.codePointAt(0) as number);
  const rightPoints = [...right].map((char) => char.codePointAt(0) as number);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function sortedNames(names: readonly string[]): string[] {
  return [...names].sort(codePointCompare);
}

function hasOwn(hierarchy: TypeHierarchy, type: string): boolean {
  return Object.prototype.hasOwnProperty.call(hierarchy, type);
}

// Python's str.strip() and JS's String.trim() disagree at the edges, and a name blank on one
// platform must be blank on the other. These are the code points only Python calls blank;
// trim() already covers the rest, U+FEFF included.
const PYTHON_ONLY_BLANKS = new Set([0x1c, 0x1d, 0x1e, 0x1f, 0x85]);

function isBlankName(name: string): boolean {
  return [...name].every((char) => char.trim().length === 0
    || PYTHON_ONLY_BLANKS.has(char.codePointAt(0) as number));
}

function cycleReason(hierarchy: TypeHierarchy): string | undefined {
  const completed = new Set<string>();
  const renderedCycles: string[] = [];

  sortedNames(Object.keys(hierarchy)).forEach((start) => {
    if (completed.has(start)) {
      return;
    }
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: string | undefined = start;
    while (current !== undefined && hasOwn(hierarchy, current)
      && !completed.has(current) && !positions.has(current)) {
      positions.set(current, path.length);
      path.push(current);
      current = hierarchy[current];
    }
    if (current !== undefined && positions.has(current)) {
      const cycle = path.slice(positions.get(current) as number);
      let smallestIndex = 0;
      cycle.forEach((name, index) => {
        if (codePointCompare(name, cycle[smallestIndex]) < 0) {
          smallestIndex = index;
        }
      });
      const rotated = cycle.slice(smallestIndex).concat(cycle.slice(0, smallestIndex));
      renderedCycles.push([...rotated, rotated[0]].join(' -> '));
    }
    path.forEach((name) => completed.add(name));
  });

  if (renderedCycles.length === 0) {
    return undefined;
  }
  renderedCycles.sort(codePointCompare);
  return `cycle ${renderedCycles[0]}`;
}

// Mirrors server/dive_utils/type_hierarchy.py so client saves and headless imports agree.
export function normalizeTypeHierarchy(value: unknown): TypeHierarchy | undefined {
  if (value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeHierarchyError('expected an object');
  }

  const source = value as Record<string, unknown>;
  const keys = sortedNames(Object.keys(source));
  if (keys.length === 0) {
    return undefined;
  }
  const entries: [string, string][] = [];
  keys.forEach((child) => {
    if (isBlankName(child)) {
      throw new TypeHierarchyError('empty child');
    }
    const parent = source[child];
    if (typeof parent !== 'string') {
      throw new TypeHierarchyError(`parent for "${child}" must be a string`);
    }
    if (isBlankName(parent)) {
      throw new TypeHierarchyError(`empty parent for "${child}"`);
    }
    if (child === parent) {
      throw new TypeHierarchyError(`self edge "${child} -> ${parent}"`);
    }
    entries.push([child, parent]);
  });

  const normalized = Object.fromEntries(entries);
  const reason = cycleReason(normalized);
  if (reason !== undefined) {
    throw new TypeHierarchyError(reason);
  }
  return normalized;
}

function conflict(reason: string): TypeHierarchyError {
  return new TypeHierarchyError(reason, 'conflict');
}

export function resolveTypeHierarchy(
  existing: unknown,
  incomingPresent: boolean,
  incoming: unknown,
  mode: 'save' | 'overwrite' | 'additive',
): HierarchyWrite {
  if (!incomingPresent) {
    return { action: 'none' };
  }

  const normalizedIncoming = normalizeTypeHierarchy(incoming);
  if (normalizedIncoming === undefined) {
    // Additive follows JSON merge semantics: an explicit null deletes, an empty map is a no-op.
    if (mode === 'additive' && incoming !== null) {
      return { action: 'none' };
    }
    return { action: 'delete' };
  }
  if (mode !== 'additive') {
    return { action: 'set', hierarchy: normalizedIncoming };
  }

  let normalizedExisting: TypeHierarchy | undefined;
  try {
    normalizedExisting = normalizeTypeHierarchy(existing);
  } catch (error) {
    if (error instanceof TypeHierarchyError) {
      throw conflict(error.reason);
    }
    throw error;
  }

  const merged = new Map<string, string>(normalizedExisting
    ? Object.entries(normalizedExisting)
    : []);
  sortedNames(Object.keys(normalizedIncoming)).forEach((child) => {
    const incomingParent = normalizedIncoming[child];
    if (merged.has(child) && merged.get(child) !== incomingParent) {
      throw conflict(
        `conflicting parents for "${child}": "${merged.get(child)}" and "${incomingParent}"`,
      );
    }
    merged.set(child, incomingParent);
  });

  try {
    return {
      action: 'set',
      hierarchy: normalizeTypeHierarchy(Object.fromEntries(merged)) as TypeHierarchy,
    };
  } catch (error) {
    if (error instanceof TypeHierarchyError) {
      throw conflict(error.reason);
    }
    throw error;
  }
}

export function compileHierarchy(hierarchy: TypeHierarchy): TypeHierarchyIndex {
  const normalized = normalizeTypeHierarchy(hierarchy) || {};
  const members = new Set<string>();
  Object.entries(normalized).forEach(([child, parent]) => {
    members.add(child);
    members.add(parent);
  });

  const ancestorEntries: [string, readonly string[]][] = [];
  sortedNames([...members]).forEach((member) => {
    const memberAncestors: string[] = [];
    let current = member;
    while (hasOwn(normalized, current)) {
      const parent = normalized[current];
      memberAncestors.push(parent);
      current = parent;
    }
    ancestorEntries.push([member, memberAncestors]);
  });

  return { hierarchy: normalized, ancestors: Object.fromEntries(ancestorEntries) };
}

function ancestorsOf(index: TypeHierarchyIndex, type: string): readonly string[] {
  return Object.prototype.hasOwnProperty.call(index.ancestors, type)
    ? index.ancestors[type]
    : [];
}

function sortPairsByConfidence(
  pairs: readonly (readonly [string, number])[],
): [string, number][] {
  return pairs
    .map(([type, confidence]) => [type, confidence] as [string, number])
    .sort((left, right) => right[1] - left[1]);
}

function inLineage(index: TypeHierarchyIndex, type: string, lineageType: string): boolean {
  return type === lineageType
    || ancestorsOf(index, lineageType).includes(type)
    || ancestorsOf(index, type).includes(lineageType);
}

export function rewriteHierarchyType(
  hierarchy: TypeHierarchy,
  currentType: string,
  newType: string,
): TypeHierarchy | undefined {
  const normalized = normalizeTypeHierarchy(hierarchy);
  if (normalized === undefined) {
    return undefined;
  }

  const rewritten = new Map<string, string>();
  const addEdge = (child: string, parent: string) => {
    if (rewritten.has(child) && rewritten.get(child) !== parent) {
      throw conflict(
        `conflicting parents for "${child}": "${rewritten.get(child)}" and "${parent}"`,
      );
    }
    rewritten.set(child, parent);
  };

  sortedNames(Object.keys(normalized))
    .filter((child) => child !== currentType)
    .forEach((child) => {
      const parent = normalized[child] === currentType ? newType : normalized[child];
      addEdge(child, parent);
    });
  if (hasOwn(normalized, currentType)) {
    addEdge(newType, normalized[currentType]);
  }

  try {
    return normalizeTypeHierarchy(Object.fromEntries(rewritten));
  } catch (error) {
    if (error instanceof TypeHierarchyError) {
      throw conflict(error.reason);
    }
    throw error;
  }
}

// Assignment replaces the selected claim's lineage while retaining unrelated claims and the
// stored ancestors still implied by the new type. No missing hierarchy members are synthesized.
export function reassignPairs(
  index: TypeHierarchyIndex,
  pairs: readonly (readonly [string, number])[],
  replaceType: string,
  newType: string,
  confidence: number,
): [string, number][] {
  const newAncestors = ancestorsOf(index, newType);
  const retained = pairs.filter(([type]) => type !== newType
    && (newAncestors.includes(type) || !inLineage(index, type, replaceType)));
  return sortPairsByConfidence([...retained, [newType, confidence]]);
}

// Acceptance is deliberately distinct from assignment: it keeps only the accepted lineage and
// changes only the accepted node's score. The accepted node itself is upserted, but absent
// ancestors and descendants remain absent.
export function acceptPairAsCorrect(
  index: TypeHierarchyIndex,
  pairs: readonly (readonly [string, number])[],
  acceptedType: string,
): [string, number][] {
  return setPairConfidence(pairs, acceptedType, 1.0)
    .filter(([type]) => inLineage(index, type, acceptedType));
}

// Confidence is data, not an instruction. In particular, 1.0 has no destructive behavior.
export function setPairConfidence(
  pairs: readonly (readonly [string, number])[],
  type: string,
  confidence: number,
): [string, number][] {
  return sortPairsByConfidence([
    ...pairs.filter(([pairType]) => pairType !== type),
    [type, confidence],
  ]);
}

// Pair removal is exact; lineage, subtree, and hierarchy-node removal are separate operations.
export function removePair(
  pairs: readonly (readonly [string, number])[],
  type: string,
): [string, number][] {
  return pairs
    .filter(([pairType]) => pairType !== type)
    .map(([pairType, confidence]) => [pairType, confidence]);
}

// Track merge combines stored evidence without invoking assignment or acceptance behavior.
// Ties use code-point order so the result does not depend on track or camera iteration order.
export function mergePairs(
  pairLists: readonly (readonly (readonly [string, number])[])[],
): [string, number][] {
  const confidenceByType = new Map<string, number>();
  pairLists.forEach((pairs) => {
    pairs.forEach(([type, confidence]) => {
      const current = confidenceByType.get(type);
      if (current === undefined || confidence > current) {
        confidenceByType.set(type, confidence);
      }
    });
  });
  return Array.from(confidenceByType.entries())
    .sort((left, right) => (right[1] - left[1]) || codePointCompare(left[0], right[0]));
}

export function selectPairIndex(
  index: TypeHierarchyIndex,
  pairs: readonly (readonly [string, number])[],
  passes: readonly boolean[],
): number {
  if (passes.length !== pairs.length) {
    throw new Error('passes and pairs must have the same length');
  }

  const passingAncestorTypes = new Set<string>();
  pairs.forEach(([type], pairIndex) => {
    if (passes[pairIndex]) {
      ancestorsOf(index, type).forEach((ancestor) => passingAncestorTypes.add(ancestor));
    }
  });
  return pairs.findIndex(([type], pairIndex) => (
    passes[pairIndex] && !passingAncestorTypes.has(type)
  ));
}
