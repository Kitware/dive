import { DesktopJob, JobType } from 'platform/desktop/constants';
import AsyncGpuJobQueue from './asyncGpuJobQueue';

it('continues to the next index build after a registered preparation failure', async () => {
  const ipc = {
    on: vi.fn(),
    invoke: vi.fn()
      .mockResolvedValueOnce({ key: 'failed', exitCode: 1, endTime: new Date() } as DesktopJob)
      .mockResolvedValueOnce({ key: 'running', exitCode: null } as DesktopJob),
  };
  const queue = new AsyncGpuJobQueue(ipc);
  await queue.enqueue({ type: JobType.BuildSearchIndex, datasetId: 'first', method: 'detections' });
  await queue.enqueue({ type: JobType.BuildSearchIndex, datasetId: 'second', method: 'detections' });
  await vi.waitFor(() => expect(queue.processingJobs.map((job) => job.key)).toEqual(['running']));
  expect(ipc.invoke).toHaveBeenCalledTimes(2);
});
