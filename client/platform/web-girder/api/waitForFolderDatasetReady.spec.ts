import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import girderRest from 'platform/web-girder/plugins/girder';
import { getFolder } from './girder.service';
import { waitForFolderDatasetReady } from './waitForFolderDatasetReady';

vi.mock('platform/web-girder/plugins/girder', () => ({
  default: { get: vi.fn() },
}));
vi.mock('./girder.service', () => ({
  getFolder: vi.fn(),
  getItemsInFolder: vi.fn(),
}));

const RUNNING = 2;
const SUCCESS = 3;

/** A job that reports one more unit of progress on every poll, reaching `total`. */
function progressingJob(total: number) {
  let current = 0;
  return () => {
    current = Math.min(current + 1, total);
    return {
      data: {
        status: current < total ? RUNNING : SUCCESS,
        progress: { current, total },
      },
    };
  };
}

describe('waitForFolderDatasetReady', () => {
  beforeEach(() => {
    vi.mocked(girderRest.get).mockReset();
    vi.mocked(getFolder).mockReset();
  });

  it('keeps waiting past the timeout while a job is still making progress', async () => {
    const job = progressingJob(40);
    let polls = 0;
    vi.mocked(girderRest.get).mockImplementation(async () => job());
    // Not ready until the job has run for far longer than timeoutMs.
    vi.mocked(getFolder).mockImplementation(async () => {
      polls += 1;
      return { data: { meta: { annotate: polls > 40 } } } as never;
    });

    await expect(waitForFolderDatasetReady(
      'folder',
      { pollIntervalMs: 5, timeoutMs: 50 },
      ['job'],
    )).resolves.toBeUndefined();
  });

  it('times out when the job stops making progress', async () => {
    vi.mocked(girderRest.get).mockResolvedValue({
      data: { status: RUNNING, progress: { current: 3, total: 10 } },
    });
    vi.mocked(getFolder).mockResolvedValue({ data: { meta: {} } } as never);

    await expect(waitForFolderDatasetReady(
      'folder',
      { pollIntervalMs: 5, timeoutMs: 50 },
      ['job'],
    )).rejects.toThrow(/Timed out/);
  });
});
