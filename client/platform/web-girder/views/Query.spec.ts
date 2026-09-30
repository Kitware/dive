import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { shallowMount } from '@vue/test-utils';
import Query from './Query.vue';
import {
  listQueryIndexes, loadQuery, loadQueryRequest, queryJobStatus, submitQuery,
} from '../api/query.service';

vi.mock('dive-common/apispec', () => ({ useApi: () => ({ loadConfig: vi.fn() }) }));
vi.mock('platform/web-girder/plugins/girder', () => ({ useGirderRest: () => ({ user: { _id: 'me' } }) }));
vi.mock('dive-common/review/frameSource', () => ({
  createFrameSourceRegistry: () => ({ frameSourceFor: vi.fn(), dispose: vi.fn() }),
}));
vi.mock('dive-common/review/chipStore', () => ({
  createChipStore: () => ({
    ensurePrimary: vi.fn(), reset: vi.fn(), chips: {}, failures: {},
  }),
}));
vi.mock('../api/query.service', () => ({
  captureQueryImage: vi.fn(),
  listQueryIndexes: vi.fn(),
  loadQuery: vi.fn(),
  loadQueryRequest: vi.fn(),
  queryJobStatus: vi.fn(),
  submitQuery: vi.fn(),
}));
vi.mock('platform/web-girder/api/scoringDatasetPicker', () => ({ pickQueryDataset: vi.fn() }));

const request = {
  operation: 'search' as const, indexIds: ['index'], image: 'png', boxes: [], feedback: [],
};
const artifact = {
  id: 'query',
  operation: 'search' as const,
  name: 'query',
  datasetIds: ['dataset'],
  jobId: 'job',
  ready: false,
};
const tick = () => vi.advanceTimersByTimeAsync(0);

describe('web query job lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    sessionStorage.clear();
    vi.mocked(listQueryIndexes).mockResolvedValue([]);
    vi.mocked(loadQuery).mockResolvedValue(artifact);
    vi.mocked(loadQueryRequest).mockResolvedValue(request);
    vi.mocked(queryJobStatus).mockResolvedValue(2);
    vi.mocked(submitQuery).mockResolvedValue(artifact);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('restores a queued query and keeps search disabled until the job finishes', async () => {
    sessionStorage.setItem('dive-web-query:me', 'query');
    const wrapper = shallowMount(Query);
    const vm = wrapper.vm as unknown as InstanceType<typeof Query>;
    await tick();
    expect(vm.busy).toBe(true);
    expect(vm.lastRequest).toEqual(request);
    vi.mocked(loadQuery).mockResolvedValue({ ...artifact, response: { results: [] } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(vm.busy).toBe(false);
    wrapper.destroy();
    const calls = vi.mocked(listQueryIndexes).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(listQueryIndexes).toHaveBeenCalledTimes(calls);
  });

  it('queues refinement with the original exemplar and index snapshots', async () => {
    sessionStorage.setItem('dive-web-query:me', 'query');
    vi.mocked(loadQuery).mockResolvedValue({ ...artifact, response: { results: [] } });
    const wrapper = shallowMount(Query);
    const vm = wrapper.vm as unknown as InstanceType<typeof Query>;
    await tick();
    vm.marks = { resultA: 'positive', resultB: 'negative' };
    await vm.search(true);
    expect(submitQuery).toHaveBeenCalledWith({
      ...request, feedback: [{ positive: ['resultA'], negative: ['resultB'] }],
    });
    expect(vm.busy).toBe(true);
    wrapper.destroy();
  });

  it('allows retry after a failed job and does not restore another user’s query', async () => {
    sessionStorage.setItem('dive-web-query:other', 'private-query');
    const wrapper = shallowMount(Query);
    const vm = wrapper.vm as unknown as InstanceType<typeof Query>;
    await tick();
    expect(loadQueryRequest).not.toHaveBeenCalled();
    vm.exemplar = 'data:image/png;base64,png';
    vm.selected = ['index'];
    await vm.search();
    vi.mocked(queryJobStatus).mockResolvedValue(4);
    await vi.advanceTimersByTimeAsync(3000);
    expect(vm.busy).toBe(false);
    expect(vm.statusText(artifact)).toContain('Failed');
    wrapper.destroy();
  });
});
