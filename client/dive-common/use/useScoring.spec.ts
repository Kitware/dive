import { createScoringService, ScoringApi } from './useScoring';
import type { ScoringResultFile, ScoringResultSummary } from '../scoring/types';
import { DEFAULT_SCORING_PARAMS } from '../scoring/metrics';

function makeApi(overrides: Partial<ScoringApi> = {}): ScoringApi {
  const stored: ScoringResultFile = {
    version: 1,
    id: 'scoring_1.json',
    datasetId: 'a',
    created: '2026-09-06T00:00:00.000Z',
    title: 'a vs b',
    pairs: [{ computed: { datasetId: 'a' }, truth: { datasetId: 'b' } }],
    params: { ...DEFAULT_SCORING_PARAMS, iouThreshold: 0.7 },
    metrics: { precision: 1 },
  };
  const summary: ScoringResultSummary = {
    id: stored.id,
    datasetId: 'a',
    created: stored.created,
    title: stored.title,
    pairs: stored.pairs,
    params: stored.params,
    headline: { precision: 1 },
  };
  return {
    runScoring: vi.fn(async () => undefined),
    listScoringResults: vi.fn(async () => [summary]),
    loadScoringResult: vi.fn(async () => stored),
    deleteScoringResult: vi.fn(async () => undefined),
    listScoringSources: vi.fn(async (id: string) => ({
      sets: id === 'a' ? ['default', 'groundTruth'] : [],
      revisions: [],
      files: [],
    })),
    listScoringDatasets: vi.fn(async () => [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]),
    loadConfig: vi.fn(async () => ({ confidenceFilters: { default: 0.1 } } as never)),
    saveConfig: vi.fn(async () => undefined),
    openFromDisk: vi.fn(async () => ({ filePaths: [] })),
    ...overrides,
  };
}

describe('createScoringService', () => {
  it('defaults the truth side to a ground-truth-named set when one exists', async () => {
    const service = createScoringService({ api: makeApi() });
    await service.setDatasets(['a', 'b', 'a']);
    expect(service.pairs.value).toHaveLength(2);
    expect(service.pairs.value[0].truth).toEqual({ datasetId: 'a', set: 'groundTruth' });
    expect(service.pairs.value[1].truth).toEqual({ datasetId: 'b' });
  });

  it('refuses to run a pair whose sides are identical', async () => {
    const api = makeApi();
    const service = createScoringService({ api });
    await service.setDatasets(['b']);
    await service.run();
    expect(api.runScoring).not.toHaveBeenCalled();
    expect(service.error.value).toContain('same annotations');
  });

  it('launches every pair as one job stored on the first computed dataset', async () => {
    const api = makeApi({ watchScoringJob: vi.fn(async () => ({ ok: true })) });
    const service = createScoringService({ api });
    await service.refreshDatasets();
    await service.setDatasets(['a']);
    service.setTruth(0, { datasetId: 'b' });
    service.swapPair(0);
    expect(service.pairs.value[0].computed.datasetId).toBe('b');
    await service.run();
    const args = (api.runScoring as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.pairs).toHaveLength(1);
    expect(args.pairs[0].computed.label).toBe('Beta');
    expect(args.title).toBe('Beta vs Alpha');
    expect(api.watchScoringJob).toHaveBeenCalledWith('b');
    expect(service.selectedResultId.value).toBe('scoring_1.json');
    expect(service.result.value?.title).toBe('a vs b');
  });

  it('applies confidence filters to every computed dataset of the loaded result', async () => {
    const api = makeApi();
    const service = createScoringService({ api });
    await service.refreshResults();
    await service.selectResult('scoring_1.json');
    expect(service.currentFilters.value).toEqual({ default: 0.1 });
    await service.applyConfidenceFilters({ fish: 0.4 });
    expect(api.saveConfig).toHaveBeenCalledWith('a', { confidenceFilters: { default: 0.1, fish: 0.4 } });
  });

  it('restores a run\'s sequences and parameters into the form', async () => {
    const service = createScoringService({ api: makeApi() });
    await service.refreshResults();
    await service.selectResult('scoring_1.json');
    service.useResultSetup();
    expect(service.pairs.value[0].truth.datasetId).toBe('b');
    expect(service.params.iouThreshold).toBe(0.7);
  });
});
