import { DesktopJobUpdate, JobType } from 'platform/desktop/constants';

const prompt = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('dive-common/vue-utilities/prompt-service', () => ({ usePrompt: () => ({ prompt }) }));
vi.mock('./dataset', () => ({ setRecents: vi.fn() }));
const Queue = vi.hoisted(() => class {
  jobSpecs = [];

  init = vi.fn();
});
vi.mock('./queues/asyncGpuJobQueue', () => ({ default: Queue }));
vi.mock('./queues/asyncCpuJobQueue', () => ({ default: Queue }));

beforeEach(() => {
  vi.resetModules();
  prompt.mockClear();
  vi.stubGlobal('window', { navigator: { userAgent: '' }, diveDesktop: { on: vi.fn(), invoke: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());
function indexingJob(): DesktopJobUpdate {
  return {
    key: 'index',
    command: '',
    workingDir: '',
    jobType: 'indexing',
    pid: 123,
    title: 'Add search index (detections)',
    args: { type: JobType.BuildSearchIndex, datasetId: 'fish', method: 'detections' },
    datasetIds: ['fish'],
    exitCode: null,
    startTime: new Date(),
    body: [],
  };
}
it('opens an indexing failure pop-up with the underlying error and retains the console log', async () => {
  const { updateHistory, jobHistory } = await import('./jobs');
  const job = indexingJob();
  updateHistory({ ...job, body: ['ERROR: Descriptor model could not be loaded'] });
  expect(prompt).not.toHaveBeenCalled();
  updateHistory({ ...job, exitCode: 1, endTime: new Date() });
  expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ title: 'Add search index (detections) failed', text: ['Descriptor model could not be loaded'] }));
  expect(jobHistory.value.index.truncatedLogs).toContain('ERROR: Descriptor model could not be loaded');
  updateHistory({ ...job, exitCode: 1, endTime: new Date() });
  expect(prompt).toHaveBeenCalledTimes(1);
});
it('does not show a failure pop-up for a canceled indexing job', async () => {
  const { updateHistory } = await import('./jobs');
  updateHistory({
    ...indexingJob(), exitCode: 143, cancelledJob: true, endTime: new Date(),
  });
  expect(prompt).not.toHaveBeenCalled();
});
