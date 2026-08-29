import { compileHierarchy } from 'dive-common/typeHierarchy';
import {
  buildTypeListModel,
  BuildTypeListOptions,
  countResolvedTypes,
  updateHierarchyCheckedTypes,
} from './typeListHierarchy';

const hierarchyIndex = compileHierarchy({
  leaf: 'branch',
  branch: 'root',
  sibling: 'root',
  otherLeaf: 'otherRoot',
});

function build(overrides: Partial<BuildTypeListOptions> = {}) {
  return buildTypeListModel({
    hierarchyIndex,
    allTypes: ['leaf', 'branch', 'root', 'sibling', 'otherLeaf', 'otherRoot', 'flat'],
    usedTypes: ['leaf', 'flat'],
    checkedTypes: ['leaf', 'branch', 'root', 'sibling', 'otherLeaf', 'otherRoot', 'flat'],
    counts: new Map([
      ['root', 5], ['branch', 4], ['leaf', 4], ['sibling', 1],
      ['otherRoot', 2], ['otherLeaf', 2], ['flat', 3],
    ]),
    frameCounts: new Map([
      ['root', 3], ['branch', 3], ['leaf', 3], ['sibling', 0],
      ['otherRoot', 1], ['otherLeaf', 1], ['flat', 2],
    ]),
    showEmpty: true,
    query: '',
    filterTypesByFrame: false,
    sort: 'a-z',
    collapsed: new Set(),
    ...overrides,
  });
}

describe('typeListHierarchy', () => {
  it('filters empty flat types and alphabetizes count ties with an empty hierarchy', () => {
    const flatIndex = compileHierarchy({});
    const common = {
      hierarchyIndex: flatIndex,
      allTypes: ['zebra', 'alpha', 'configured'],
      usedTypes: ['zebra', 'alpha'],
      checkedTypes: ['zebra', 'alpha', 'configured'],
      counts: new Map([['zebra', 1], ['alpha', 1]]),
      frameCounts: new Map<string, number>(),
      query: '',
      filterTypesByFrame: false,
      sort: 'count' as const,
      collapsed: new Set<string>(),
    };

    const showEmpty = buildTypeListModel({ ...common, showEmpty: true });
    const hideEmpty = buildTypeListModel({ ...common, showEmpty: false });

    expect(showEmpty.actionableTypes).toEqual(['alpha', 'zebra', 'configured']);
    expect(showEmpty.rows.map(({ type }) => type)).toEqual(['alpha', 'zebra', 'configured']);
    expect(showEmpty.rows.every(
      ({ depth, hasChildren }) => depth === 0 && !hasChildren,
    )).toBe(true);
    expect(hideEmpty.actionableTypes).toEqual(['alpha', 'zebra']);
  });

  it('rolls resolved logical IDs into ancestors without double counting replicas or raw pairs', () => {
    const counts = countResolvedTypes([
      { id: 1, type: 'leaf' },
      { id: 1, type: 'leaf' },
      { id: 2, type: 'branch' },
      { id: 3, type: 'otherLeaf' },
      { id: 4 },
      { id: 5, type: 'toString' },
    ], hierarchyIndex);

    expect(counts).toEqual(new Map([
      ['leaf', 1],
      ['branch', 2],
      ['root', 2],
      ['otherLeaf', 1],
      ['otherRoot', 1],
      ['toString', 1],
    ]));
  });

  it('derives a three-level forest, unrelated roots, depths, and subtrees', () => {
    const model = build();

    expect(model.subtree.get('branch')).toEqual(['branch', 'leaf']);
    expect(model.rows.map(({ type }) => type)).toEqual([
      'flat', 'otherRoot', 'otherLeaf', 'root', 'branch', 'leaf', 'sibling',
    ]);
    expect(model.rows.find(({ type }) => type === 'leaf')?.depth).toBe(2);
    expect(model.rows.find(({ type }) => type === 'flat')?.depth).toBe(0);
  });

  it('hides disclosure controls when all children are filtered out', () => {
    const model = build({ showEmpty: false });

    expect(model.rows.find(({ type }) => type === 'otherRoot')).toEqual(expect.objectContaining({
      hasChildren: false,
    }));
    expect(model.rows.some(({ type }) => type === 'otherLeaf')).toBe(false);
  });

  it('sorts roots and siblings recursively in every mode with alphabetical ties', () => {
    const alphabetical = build({ sort: 'a-z' });
    expect(alphabetical.rows.map(({ type }) => type)).toEqual([
      'flat', 'otherRoot', 'otherLeaf', 'root', 'branch', 'leaf', 'sibling',
    ]);

    const byCount = build({
      sort: 'count',
      counts: new Map([
        ['root', 3], ['flat', 2], ['otherRoot', 1], ['branch', 1], ['sibling', 2],
      ]),
    });
    expect(byCount.rows.map(({ type }) => type)).toEqual([
      'root', 'sibling', 'branch', 'leaf', 'flat', 'otherRoot', 'otherLeaf',
    ]);

    const byFrameCount = build({
      sort: 'frame count',
      frameCounts: new Map([
        ['root', 1], ['flat', 2], ['otherRoot', 3], ['branch', 2], ['sibling', 1],
      ]),
    });
    expect(byFrameCount.rows.map(({ type }) => type)).toEqual([
      'otherRoot', 'otherLeaf', 'flat', 'root', 'branch', 'leaf', 'sibling',
    ]);
  });

  it('applies every sort mode to siblings below the first hierarchy level', () => {
    const deepIndex = compileHierarchy({
      leaf: 'branch',
      bud: 'branch',
      twig: 'branch',
      branch: 'root',
    });
    const shared = {
      hierarchyIndex: deepIndex,
      allTypes: ['root', 'branch', 'leaf', 'bud', 'twig'],
      usedTypes: ['leaf', 'bud', 'twig'],
      checkedTypes: ['root', 'branch', 'leaf', 'bud', 'twig'],
    };

    expect(build({ ...shared, sort: 'a-z' }).rows.filter(({ depth }) => depth === 2)
      .map(({ type }) => type))
      .toEqual(['bud', 'leaf', 'twig']);
    expect(build({
      ...shared,
      sort: 'count',
      counts: new Map([['leaf', 3], ['bud', 1], ['twig', 1]]),
    }).rows.filter(({ depth }) => depth === 2).map(({ type }) => type))
      .toEqual(['leaf', 'bud', 'twig']);
    expect(build({
      ...shared,
      sort: 'frame count',
      frameCounts: new Map([['twig', 4], ['leaf', 2], ['bud', 1]]),
    }).rows.filter(({ depth }) => depth === 2).map(({ type }) => type))
      .toEqual(['twig', 'leaf', 'bud']);
  });

  it('keeps unused structural parents but hides empty leaves and configured flat types', () => {
    const model = build({
      allTypes: [
        'leaf', 'branch', 'root', 'sibling', 'otherLeaf', 'otherRoot', 'flat', 'configured',
      ],
      usedTypes: ['leaf', 'flat'],
      showEmpty: false,
    });

    expect(model.rows.map(({ type }) => type)).toEqual(['flat', 'otherRoot', 'root', 'branch', 'leaf']);
    expect(model.rows.map(({ type }) => type)).not.toContain('otherLeaf');
    expect(model.rows.map(({ type }) => type)).not.toContain('sibling');
    expect(model.rows.map(({ type }) => type)).not.toContain('configured');
  });

  it('shows search matches with ancestor context but no unrelated descendants', () => {
    const model = build({ query: 'leaf' });

    expect(model.actionableTypes).toEqual(['otherLeaf', 'leaf']);
    expect(model.rows.map(({ type }) => type)).toEqual([
      'otherRoot', 'otherLeaf', 'root', 'branch', 'leaf',
    ]);
    expect(model.rows.map(({ type }) => type)).not.toContain('sibling');
  });

  it('reveals search paths without mutating or applying saved collapse state', () => {
    const collapsed = new Set(['root']);
    const collapsedModel = build({ collapsed });
    const searchModel = build({ collapsed, query: 'leaf' });
    const restoredModel = build({ collapsed });

    expect(collapsedModel.rows.map(({ type }) => type)).not.toContain('leaf');
    expect(searchModel.rows.map(({ type }) => type)).toContain('leaf');
    expect(searchModel.rows.find(({ type }) => type === 'root')?.expanded).toBe(true);
    expect(restoredModel.rows.map(({ type }) => type)).not.toContain('leaf');
    expect(collapsed).toEqual(new Set(['root']));
  });

  it('compacts a shared leading lineage and restores it during search or on request', () => {
    const deepIndex = compileHierarchy({
      speciesA: 'genusA',
      genusA: 'familyA',
      familyA: 'orderA',
      speciesB: 'genusB',
      genusB: 'familyB',
      familyB: 'orderB',
      orderA: 'class',
      orderB: 'class',
      class: 'phylum',
      phylum: 'kingdom',
      kingdom: 'domain',
    });
    const options = {
      hierarchyIndex: deepIndex,
      allTypes: [],
      usedTypes: ['speciesA', 'speciesB'],
      checkedTypes: [],
      compactSharedLineage: true,
    };

    const compact = build(options);
    expect(compact.sharedLineage).toEqual(['domain', 'kingdom', 'phylum']);
    expect(compact.rows.slice(0, 3).map(({ type, depth }) => ({ type, depth }))).toEqual([
      { type: 'class', depth: 0 },
      { type: 'orderA', depth: 1 },
      { type: 'familyA', depth: 2 },
    ]);

    const shown = build({ ...options, compactSharedLineage: false });
    expect(shown.rows.slice(0, 4).map(({ type, depth }) => ({ type, depth }))).toEqual([
      { type: 'domain', depth: 0 },
      { type: 'kingdom', depth: 1 },
      { type: 'phylum', depth: 2 },
      { type: 'class', depth: 3 },
    ]);

    const searched = build({ ...options, query: 'domain' });
    expect(searched.rows.map(({ type }) => type)).toEqual(['domain']);
    expect(searched.rows[0].depth).toBe(0);
  });

  it('preserves depth in unrelated trees while compacting a shared lineage', () => {
    const forestIndex = compileHierarchy({
      species: 'genus',
      genus: 'family',
      family: 'root',
      emptyLeaf: 'emptyBranch',
      emptyBranch: 'emptyRoot',
    });
    const model = build({
      hierarchyIndex: forestIndex,
      allTypes: [],
      usedTypes: ['species'],
      checkedTypes: [],
      showEmpty: true,
      compactSharedLineage: true,
    });

    expect(model.sharedLineage).toEqual(['root', 'family', 'genus']);
    expect(model.rows.filter(({ type }) => type.startsWith('empty'))
      .map(({ type, depth }) => ({ type, depth }))).toEqual([
      { type: 'emptyRoot', depth: 0 },
      { type: 'emptyBranch', depth: 1 },
      { type: 'emptyLeaf', depth: 2 },
    ]);
    expect(model.rows.find(({ type }) => type === 'species')?.depth).toBe(0);
  });

  it('does not compact past a branch or a directly used or configured type', () => {
    const branchAtRoot = build({
      usedTypes: ['leaf'],
      configuredTypes: [],
      compactSharedLineage: true,
    });
    expect(branchAtRoot.sharedLineage).toEqual([]);

    const deepIndex = compileHierarchy({
      leaf: 'configured', configured: 'middle', middle: 'top',
    });
    const stopped = build({
      hierarchyIndex: deepIndex,
      allTypes: [],
      usedTypes: ['leaf'],
      configuredTypes: ['configured'],
      compactSharedLineage: true,
    });
    expect(stopped.sharedLineage).toEqual(['top', 'middle']);
    expect(stopped.rows[0]).toEqual(expect.objectContaining({
      type: 'configured', depth: 0,
    }));
  });

  it('uses rolled frame counts before adding ancestor context', () => {
    const model = build({
      frameCounts: new Map([['branch', 2], ['leaf', 2]]),
      filterTypesByFrame: true,
    });

    expect(model.rows.map(({ type }) => type)).toEqual(['root', 'branch', 'leaf']);
    expect(model.rows.map(({ type }) => type)).not.toContain('otherRoot');
    expect(model.rows.map(({ type }) => type)).not.toContain('sibling');
    expect(model.actionableTypes).toContain('flat');
  });

  it('includes the parent bit when computing checked and indeterminate state', () => {
    const model = build({ checkedTypes: ['leaf'] });

    expect(model.checkState.get('leaf')).toBe('checked');
    expect(model.checkState.get('branch')).toBe('indeterminate');
    expect(model.checkState.get('root')).toBe('indeterminate');
    expect(model.checkState.get('otherRoot')).toBe('unchecked');
    expect(model.rows.find(({ type }) => type === 'branch')).toEqual(expect.objectContaining({
      checked: false,
      indeterminate: true,
    }));
  });

  it('represents the checked set produced when a used unchecked parent gains a new child', () => {
    const model = build({ usedTypes: ['branch'], checkedTypes: ['leaf'] });

    expect(model.checkState.get('branch')).toBe('indeterminate');
    expect(model.subtree.get('branch')).toEqual(['branch', 'leaf']);
  });

  it.each([
    ['collapse', { showEmpty: true, query: '', collapsed: new Set(['branch']) }],
    ['Show Empty', {
      showEmpty: false, usedTypes: ['flat'], query: '', collapsed: new Set<string>(),
    }],
    ['search', { showEmpty: true, query: 'branch', collapsed: new Set<string>() }],
  ] as const)('updates descendants hidden by %s without mutating checked input', (
    _visibility,
    overrides,
  ) => {
    const model = build(overrides);
    const checked = Object.freeze(['flat', 'sibling']);

    expect(model.rows.map(({ type }) => type)).not.toContain('leaf');
    const enabled = updateHierarchyCheckedTypes(checked, model.subtree, 'branch', true);
    const disabled = updateHierarchyCheckedTypes(enabled, model.subtree, 'branch', false);

    expect(enabled).toEqual(['flat', 'sibling', 'branch', 'leaf']);
    expect(disabled).toEqual(['flat', 'sibling']);
    expect(checked).toEqual(['flat', 'sibling']);
  });

  it('does not mutate hierarchy, arrays, sets, or count maps', () => {
    const allTypes = Object.freeze(['leaf', 'branch', 'root', 'flat']);
    const usedTypes = Object.freeze(['leaf']);
    const checkedTypes = Object.freeze(['leaf']);
    const counts = new Map([['leaf', 1]]);
    const frameCounts = new Map([['leaf', 1]]);
    const collapsed = new Set(['root']);
    const hierarchy = Object.freeze({ leaf: 'branch', branch: 'root' });
    const index = compileHierarchy(hierarchy);

    buildTypeListModel({
      hierarchyIndex: index,
      allTypes,
      usedTypes,
      checkedTypes,
      counts,
      frameCounts,
      showEmpty: false,
      query: '',
      filterTypesByFrame: true,
      sort: 'count',
      collapsed,
    });

    expect(index.hierarchy).toEqual(hierarchy);
    expect(allTypes).toEqual(['leaf', 'branch', 'root', 'flat']);
    expect(usedTypes).toEqual(['leaf']);
    expect(checkedTypes).toEqual(['leaf']);
    expect(counts).toEqual(new Map([['leaf', 1]]));
    expect(frameCounts).toEqual(new Map([['leaf', 1]]));
    expect(collapsed).toEqual(new Set(['root']));
  });
});
