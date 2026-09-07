import {
  computed, inject, provide, reactive, ref, Ref, watch,
} from 'vue';
import type { Api } from 'dive-common/apispec';
import type {
  ScoringDatasetSummary,
  ScoringJobArgs,
  ScoringPair,
  ScoringParams,
  ScoringResult,
  ScoringResultSummary,
  ScoringSource,
  ScoringSourceOptions,
} from 'dive-common/scoring/types';
import {
  CLASS_PALETTE,
  DEFAULT_SCORING_PARAMS,
  describeSource,
  parseScoringMatches,
  parseScoringMetrics,
  ScoringMatch,
  ScoringMetrics,
} from 'dive-common/scoring/metrics';

const PARAMS_STORAGE_KEY = 'dive.scoring.params';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000;

export const TRUTH_SET_NAMES = ['groundTruth', 'GT', 'ground_truth', 'Groundtruth', 'GroundTruth', 'gt', 'truth'];

export type ScoringApi = Pick<Api,
  'runScoring' | 'watchScoringJob' | 'listScoringResults' | 'loadScoringResult'
  | 'deleteScoringResult' | 'listScoringSources' | 'listScoringDatasets' | 'pickScoringDataset'
  | 'openFromDisk' | 'loadConfig' | 'saveConfig'>;

export interface ScoringServiceDeps {
  api: ScoringApi;
}

export interface ScoringService {
  available: Readonly<Ref<boolean>>;
  pairs: Ref<ScoringPair[]>;
  params: ScoringParams;
  datasets: Readonly<Ref<ScoringDatasetSummary[]>>;
  results: Readonly<Ref<ScoringResultSummary[]>>;
  selectedResultId: Readonly<Ref<string | null>>;
  result: Readonly<Ref<ScoringResult | null>>;
  metrics: Readonly<Ref<ScoringMetrics | null>>;
  matches: Readonly<Ref<ScoringMatch[]>>;
  /** Confidence filters currently saved on the loaded result's primary computed dataset */
  currentFilters: Readonly<Ref<Record<string, number>>>;
  running: Readonly<Ref<boolean>>;
  loading: Readonly<Ref<boolean>>;
  status: Readonly<Ref<string | null>>;
  error: Readonly<Ref<string | null>>;
  datasetName(id: string): string;
  sourceLabel(source: ScoringSource): string;
  classColor(name: string): string;
  sourceOptions(datasetId: string): Promise<ScoringSourceOptions>;
  refreshDatasets(): Promise<void>;
  refreshResults(): Promise<void>;
  selectResult(id: string | null): Promise<void>;
  deleteResult(id: string): Promise<void>;
  addDataset(datasetId: string, summary?: ScoringDatasetSummary): Promise<void>;
  setDatasets(datasetIds: string[]): Promise<void>;
  removePair(index: number): void;
  swapPair(index: number): void;
  setComputed(index: number, source: ScoringSource): void;
  setTruth(index: number, source: ScoringSource): void;
  useResultSetup(): void;
  resetParams(): void;
  run(): Promise<void>;
  applyConfidenceFilters(filters: Record<string, number>): Promise<void>;
  clearError(): void;
}

function loadStoredParams(): ScoringParams {
  try {
    const raw = window.localStorage.getItem(PARAMS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_SCORING_PARAMS, ...parsed };
      }
    }
  } catch {
    // Storage may be unavailable; defaults are fine.
  }
  return { ...DEFAULT_SCORING_PARAMS };
}

function storeParams(params: ScoringParams) {
  try {
    window.localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params));
  } catch {
    // Ignore storage failures.
  }
}

export function sameSource(a: ScoringSource, b: ScoringSource) {
  return a.datasetId === b.datasetId
    && (a.set || '') === (b.set || '')
    && a.revision === b.revision
    && (a.file || '') === (b.file || '');
}

export function createScoringService(deps: ScoringServiceDeps): ScoringService {
  const { api } = deps;
  const available = computed(() => typeof api.runScoring === 'function'
    && typeof api.listScoringResults === 'function'
    && typeof api.loadScoringResult === 'function');

  const pairs = ref<ScoringPair[]>([]);
  const params = reactive<ScoringParams>(loadStoredParams());
  watch(params, () => storeParams({ ...params }), { deep: true });

  const datasets = ref<ScoringDatasetSummary[]>([]);
  const optionsCache = new Map<string, ScoringSourceOptions>();
  const results = ref<ScoringResultSummary[]>([]);
  const selectedResultId = ref<string | null>(null);
  const result = ref<ScoringResult | null>(null);
  const currentFilters = ref<Record<string, number>>({});
  const running = ref(false);
  const loading = ref(false);
  const status = ref<string | null>(null);
  const error = ref<string | null>(null);

  const metrics = computed(() => (result.value ? parseScoringMetrics(result.value.metrics) : null));
  const matches = computed(() => (result.value ? parseScoringMatches(result.value.matches) : []));

  const classColors = new Map<string, string>();
  function classColor(name: string) {
    let color = classColors.get(name);
    if (!color) {
      color = CLASS_PALETTE[classColors.size % CLASS_PALETTE.length];
      classColors.set(name, color);
    }
    return color;
  }

  function datasetName(id: string) {
    return datasets.value.find((d) => d.id === id)?.name || id;
  }

  function sourceLabel(source: ScoringSource) {
    return describeSource(source, datasetName(source.datasetId));
  }

  function fail(reason: unknown, fallback: string) {
    const message = reason instanceof Error ? reason.message : String(reason || fallback);
    error.value = message || fallback;
  }

  async function refreshDatasets() {
    if (!api.listScoringDatasets) return;
    try {
      datasets.value = await api.listScoringDatasets();
    } catch (err) {
      fail(err, 'Could not list datasets');
    }
  }

  async function sourceOptions(datasetId: string): Promise<ScoringSourceOptions> {
    const cached = optionsCache.get(datasetId);
    if (cached) return cached;
    const empty: ScoringSourceOptions = { sets: [], revisions: [], files: [] };
    if (!api.listScoringSources) return empty;
    try {
      const options = await api.listScoringSources(datasetId);
      optionsCache.set(datasetId, options);
      return options;
    } catch (err) {
      fail(err, 'Could not list annotation sources');
      return empty;
    }
  }

  async function refreshResults() {
    if (!api.listScoringResults) return;
    loading.value = true;
    try {
      const list = await api.listScoringResults();
      results.value = [...list].sort((a, b) => b.created.localeCompare(a.created));
      if (selectedResultId.value && !results.value.some((r) => r.id === selectedResultId.value)) {
        selectedResultId.value = null;
        result.value = null;
      }
    } catch (err) {
      fail(err, 'Could not list scoring results');
    } finally {
      loading.value = false;
    }
  }

  async function loadCurrentFilters() {
    currentFilters.value = {};
    const primary = result.value?.pairs[0]?.computed.datasetId;
    if (!primary) return;
    try {
      const config = await api.loadConfig(primary);
      currentFilters.value = { ...(config.confidenceFilters || {}) };
    } catch {
      // The dataset may be gone; the charts simply omit the current-filter line.
    }
  }

  async function selectResult(id: string | null) {
    selectedResultId.value = id;
    if (!id || !api.loadScoringResult) {
      result.value = null;
      currentFilters.value = {};
      return;
    }
    const summary = results.value.find((r) => r.id === id);
    if (!summary) {
      result.value = null;
      return;
    }
    loading.value = true;
    try {
      result.value = await api.loadScoringResult(summary.datasetId, id);
      await loadCurrentFilters();
    } catch (err) {
      result.value = null;
      fail(err, 'Could not load the scoring result');
    } finally {
      loading.value = false;
    }
  }

  async function deleteResult(id: string) {
    if (!api.deleteScoringResult) return;
    const summary = results.value.find((r) => r.id === id);
    if (!summary) return;
    try {
      await api.deleteScoringResult(summary.datasetId, id);
      if (selectedResultId.value === id) {
        selectedResultId.value = null;
        result.value = null;
      }
      await refreshResults();
    } catch (err) {
      fail(err, 'Could not delete the scoring result');
    }
  }

  /**
   * A set named like ground truth is the obvious truth side when the platform
   * has sets; otherwise both sides start on the current annotations and the
   * user picks a revision, file or other dataset for one of them.
   */
  async function defaultPair(datasetId: string): Promise<ScoringPair> {
    const options = await sourceOptions(datasetId);
    const gtSet = options.sets.find((s) => TRUTH_SET_NAMES.includes(s));
    return {
      computed: { datasetId },
      truth: gtSet ? { datasetId, set: gtSet } : { datasetId },
    };
  }

  function rememberDataset(summary?: ScoringDatasetSummary) {
    if (!summary || datasets.value.some((d) => d.id === summary.id)) return;
    datasets.value = [...datasets.value, summary];
  }

  async function addDataset(datasetId: string, summary?: ScoringDatasetSummary) {
    if (pairs.value.some((p) => p.computed.datasetId === datasetId)) return;
    rememberDataset(summary);
    pairs.value = [...pairs.value, await defaultPair(datasetId)];
  }

  async function setDatasets(datasetIds: string[]) {
    const unique = Array.from(new Set(datasetIds.filter(Boolean)));
    pairs.value = await Promise.all(unique.map(defaultPair));
  }

  function removePair(index: number) {
    pairs.value = pairs.value.filter((_, i) => i !== index);
  }

  function swapPair(index: number) {
    pairs.value = pairs.value.map((p, i) => (i === index ? { computed: p.truth, truth: p.computed } : p));
  }

  function setComputed(index: number, source: ScoringSource) {
    pairs.value = pairs.value.map((p, i) => (i === index ? { ...p, computed: source } : p));
  }

  function setTruth(index: number, source: ScoringSource) {
    pairs.value = pairs.value.map((p, i) => (i === index ? { ...p, truth: source } : p));
  }

  function useResultSetup() {
    if (!result.value) return;
    pairs.value = result.value.pairs.map((p) => ({ computed: { ...p.computed }, truth: { ...p.truth } }));
    Object.assign(params, DEFAULT_SCORING_PARAMS, result.value.params);
  }

  function resetParams() {
    Object.assign(params, DEFAULT_SCORING_PARAMS);
  }

  function clearError() {
    error.value = null;
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => { setTimeout(resolve, ms); });
  }

  /**
   * Without a job feed the only signal that a run finished is its result
   * appearing in the listing, so poll for an entry newer than the launch.
   */
  async function pollForResult(startedAt: string): Promise<ScoringResultSummary | null> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(POLL_INTERVAL_MS);
      // eslint-disable-next-line no-await-in-loop
      await refreshResults();
      const fresh = results.value.find((r) => r.created >= startedAt);
      if (fresh) return fresh;
    }
    return null;
  }

  function validatePairs(): string | null {
    if (pairs.value.length === 0) return 'Add at least one sequence to score.';
    const bad = pairs.value.find((p) => sameSource(p.computed, p.truth));
    if (bad) {
      return `${datasetName(bad.computed.datasetId)}: computed and truth point at the same annotations; pick a different set, revision, file or dataset for one of them.`;
    }
    return null;
  }

  async function run() {
    if (!api.runScoring || running.value) return;
    const problem = validatePairs();
    if (problem) {
      error.value = problem;
      return;
    }
    error.value = null;
    running.value = true;
    status.value = 'Launching scoring job';
    const startedAt = new Date().toISOString();
    const labelled = pairs.value.map((p) => ({
      computed: { ...p.computed, label: sourceLabel(p.computed) },
      truth: { ...p.truth, label: sourceLabel(p.truth) },
    }));
    const first = labelled[0];
    const title = labelled.length === 1
      ? `${first.computed.label} vs ${first.truth.label}`
      : `${first.computed.label} vs ${first.truth.label} (+${labelled.length - 1} more)`;
    const args: ScoringJobArgs = { pairs: labelled, params: { ...params }, title };
    const primary = first.computed.datasetId;
    try {
      await api.runScoring(args);
      status.value = `Scoring ${labelled.length} sequence${labelled.length === 1 ? '' : 's'}`;
      let newest: ScoringResultSummary | null = null;
      if (api.watchScoringJob) {
        const outcome = await api.watchScoringJob(primary);
        if (!outcome.ok) {
          throw new Error(outcome.message || 'The scoring job failed; see the Jobs tab for its log.');
        }
        await refreshResults();
        newest = results.value.find((r) => r.created >= startedAt && r.datasetId === primary)
          || results.value[0] || null;
      } else {
        newest = await pollForResult(startedAt);
        if (!newest) throw new Error('Timed out waiting for the scoring result.');
      }
      if (newest) await selectResult(newest.id);
      status.value = null;
    } catch (err) {
      status.value = null;
      fail(err, 'Scoring failed');
    } finally {
      running.value = false;
    }
  }

  /** Save the filters on every computed dataset of the loaded result. */
  async function applyConfidenceFilters(filters: Record<string, number>) {
    const targets = Array.from(new Set((result.value?.pairs || []).map((p) => p.computed.datasetId)));
    try {
      await Promise.all(targets.map(async (datasetId) => {
        const config = await api.loadConfig(datasetId);
        await api.saveConfig(datasetId, {
          confidenceFilters: { ...(config.confidenceFilters || {}), ...filters },
        });
      }));
      await loadCurrentFilters();
    } catch (err) {
      fail(err, 'Could not save the confidence filters');
    }
  }

  return {
    available,
    pairs,
    params,
    datasets,
    results,
    selectedResultId,
    result,
    metrics,
    matches,
    currentFilters,
    running,
    loading,
    status,
    error,
    datasetName,
    sourceLabel,
    classColor,
    sourceOptions,
    refreshDatasets,
    refreshResults,
    selectResult,
    deleteResult,
    addDataset,
    setDatasets,
    removePair,
    swapPair,
    setComputed,
    setTruth,
    useResultSetup,
    resetParams,
    run,
    applyConfidenceFilters,
    clearError,
  };
}

const ScoringSymbol = Symbol('scoring');

export function provideScoring(service: ScoringService) {
  provide(ScoringSymbol, service);
}

export function useScoring(): ScoringService {
  const service = inject<ScoringService | null>(ScoringSymbol, null);
  if (!service) {
    throw new Error('Scoring service not provided');
  }
  return service;
}
