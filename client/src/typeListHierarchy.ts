/**
 * Pure Type List model helpers shared by flat and hierarchical modes.
 * This module has no Vue or store dependencies; callers provide all state explicitly.
 */
import { difference, union } from 'lodash';
import { ancestorsOf, TypeHierarchyIndex } from 'dive-common/typeHierarchy';

export type TypeListSort = 'a-z' | 'count' | 'frame count';
export type TypeListCheckState = 'checked' | 'unchecked' | 'indeterminate';

export interface TypeListRow {
  type: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  checked: boolean;
  indeterminate: boolean;
}

export interface TypeListModel {
  hasDefinedTypes: boolean;
  subtree: ReadonlyMap<string, readonly string[]>;
  checkState: ReadonlyMap<string, TypeListCheckState>;
  actionableTypes: readonly string[];
  actionableCheckedTypes: readonly string[];
  sharedLineage: readonly string[];
  rows: readonly TypeListRow[];
}

export interface BuildTypeListOptions {
  hierarchyIndex: TypeHierarchyIndex;
  allTypes: readonly string[];
  usedTypes: readonly string[];
  configuredTypes?: readonly string[];
  checkedTypes: readonly string[];
  counts: ReadonlyMap<string, number>;
  frameCounts: ReadonlyMap<string, number>;
  showEmpty: boolean;
  query: string;
  filterTypesByFrame: boolean;
  sort: TypeListSort;
  collapsed: ReadonlySet<string>;
  compactSharedLineage?: boolean;
}

export interface ResolvedTypeCountEntry {
  id: string | number;
  type?: string;
}

export function countResolvedTypes(
  entries: readonly ResolvedTypeCountEntry[],
  hierarchyIndex: TypeHierarchyIndex,
): Map<string, number> {
  const idsByType = new Map<string, Set<string | number>>();
  entries.forEach(({ id, type }) => {
    if (type === undefined) return;
    [type, ...ancestorsOf(hierarchyIndex, type)].forEach((rolledType) => {
      const ids = idsByType.get(rolledType) || new Set<string | number>();
      ids.add(id);
      idsByType.set(rolledType, ids);
    });
  });
  return new Map([...idsByType].map(([type, ids]) => [type, ids.size]));
}

/** Descending by the active count, then alphabetical so ties are deterministic. */
function typeComparator(
  sort: TypeListSort,
  counts: ReadonlyMap<string, number>,
  frameCounts: ReadonlyMap<string, number>,
): (left: string, right: string) => number {
  const rank = { 'a-z': undefined, count: counts, 'frame count': frameCounts }[sort];
  return (left, right) => {
    const countDifference = rank ? (rank.get(right) || 0) - (rank.get(left) || 0) : 0;
    if (countDifference !== 0) return countDifference;
    if (left < right) return -1;
    return left > right ? 1 : 0;
  };
}

function withAncestorPath(
  types: Iterable<string>,
  hierarchyIndex: TypeHierarchyIndex,
): Set<string> {
  const withAncestors = new Set(types);
  [...withAncestors].forEach(
    (type) => ancestorsOf(hierarchyIndex, type).forEach((ancestor) => withAncestors.add(ancestor)),
  );
  return withAncestors;
}

export function buildTypeListModel({
  hierarchyIndex,
  allTypes,
  usedTypes,
  configuredTypes = [],
  checkedTypes,
  counts,
  frameCounts,
  showEmpty,
  query,
  filterTypesByFrame,
  sort,
  collapsed,
  compactSharedLineage = false,
}: BuildTypeListOptions): TypeListModel {
  const parent = new Map<string, string>();
  const hierarchyMembers = new Set<string>();
  Object.entries(hierarchyIndex.hierarchy).forEach(([child, parentType]) => {
    parent.set(child, parentType);
    hierarchyMembers.add(child);
    hierarchyMembers.add(parentType);
  });

  const knownTypes = new Set([...allTypes, ...usedTypes, ...hierarchyMembers]);
  const compare = typeComparator(sort, counts, frameCounts);
  const children = new Map<string, string[]>();
  knownTypes.forEach((type) => children.set(type, []));
  parent.forEach((parentType, child) => children.get(parentType)?.push(child));
  children.forEach((childTypes) => {
    if (childTypes.length > 1) childTypes.sort(compare);
  });
  const roots = [...knownTypes].filter((type) => !parent.has(type)).sort(compare);

  const directlyMeaningfulTypes = new Set([...usedTypes, ...configuredTypes]);
  const hierarchyTargets = [...directlyMeaningfulTypes].filter((type) => hierarchyMembers.has(type));
  const targetRoots = new Set(hierarchyTargets.map((type) => {
    const ancestors = ancestorsOf(hierarchyIndex, type);
    return ancestors.length > 0 ? ancestors[ancestors.length - 1] : type;
  }));
  const unusedLeadingParents: string[] = [];
  if (hierarchyTargets.length === directlyMeaningfulTypes.size && targetRoots.size === 1) {
    let current = [...targetRoots][0];
    while (!directlyMeaningfulTypes.has(current)) {
      const childTypes = children.get(current) || [];
      if (childTypes.length !== 1) break;
      unusedLeadingParents.push(current);
      [current] = childTypes;
    }
  }
  /* A single unused parent is not worth a breadcrumb; show it as a row instead. */
  const sharedLineage = unusedLeadingParents.length >= 2 ? unusedLeadingParents : [];

  const checkedSet = new Set(checkedTypes);
  const subtree = new Map<string, readonly string[]>();
  const checkState = new Map<string, TypeListCheckState>();
  /* One pass yields each type's pre-order subtree and its rolled-up tri-state. */
  const visit = (type: string): { members: string[]; checkedCount: number } => {
    let checkedCount = checkedSet.has(type) ? 1 : 0;
    const members = [type];
    (children.get(type) || []).forEach((child) => {
      const nested = visit(child);
      members.push(...nested.members);
      checkedCount += nested.checkedCount;
    });
    subtree.set(type, members);
    let state: TypeListCheckState = 'indeterminate';
    if (checkedCount === 0) state = 'unchecked';
    else if (checkedCount === members.length) state = 'checked';
    checkState.set(type, state);
    return { members, checkedCount };
  };
  roots.forEach(visit);

  const normalizedQuery = query.toLowerCase();
  const searchActive = normalizedQuery.length > 0;
  const hiddenSharedLineage = !searchActive && compactSharedLineage
    ? new Set(sharedLineage)
    : new Set<string>();
  /* Show Empty off keeps the path back to each root, so ancestors of a used
     type stay actionable rows; a branch with no annotations anywhere has
     nothing to lead to and drops out entirely. */
  const showEmptyCandidates = showEmpty
    ? knownTypes
    : withAncestorPath(usedTypes, hierarchyIndex);
  const queryCandidates = normalizedQuery
    ? [...showEmptyCandidates].filter((type) => type.toLowerCase().includes(normalizedQuery))
    : [...showEmptyCandidates];
  const displayedCandidates = filterTypesByFrame
    ? queryCandidates.filter((type) => (frameCounts.get(type) || 0) > 0)
    : queryCandidates;
  const actionableSet = new Set(displayedCandidates);
  const displayedSet = withAncestorPath(displayedCandidates, hierarchyIndex);
  const rows: TypeListRow[] = [];
  const flatten = (type: string, rowDepth: number) => {
    if (!displayedSet.has(type)) return;
    const childTypes = children.get(type) || [];
    if (hiddenSharedLineage.has(type)) {
      childTypes.forEach((child) => flatten(child, rowDepth));
      return;
    }
    const expanded = searchActive || !collapsed.has(type);
    const state = checkState.get(type) || 'unchecked';
    rows.push({
      type,
      depth: rowDepth,
      hasChildren: childTypes.some((child) => displayedSet.has(child)),
      expanded,
      checked: state === 'checked',
      indeterminate: state === 'indeterminate',
    });
    if (expanded) {
      childTypes.forEach((child) => flatten(child, rowDepth + 1));
    }
  };
  roots.forEach((root) => flatten(root, 0));

  /* The set the header checkbox and the delete button act on: every type the
     filters kept, minus the ancestors a breadcrumb replaced. Deliberately not
     the row list, which adds ancestors shown only as context for a match below
     them and drops the descendants a collapsed row hides. */
  const actionableTypes = roots
    .flatMap((root) => subtree.get(root) ?? [root])
    .filter((type) => actionableSet.has(type) && !hiddenSharedLineage.has(type));

  return {
    hasDefinedTypes: knownTypes.size > 0,
    subtree,
    checkState,
    sharedLineage,
    actionableTypes,
    actionableCheckedTypes: actionableTypes.filter((type) => checkedSet.has(type)),
    rows,
  };
}

export function updateHierarchyCheckedTypes(
  checkedTypes: readonly string[],
  subtree: ReadonlyMap<string, readonly string[]>,
  type: string,
  checked: boolean,
): string[] {
  const members = subtree.get(type) || [type];
  return checked
    ? union(checkedTypes, members)
    : difference(checkedTypes, members);
}
