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

describe('waitForFolderDatasetReady', () => {
  beforeEach(() => {
    vi.mocked(girderRest.get).mockReset();
    vi.mocked(getFolder).mockReset();
  });

  it('reports summed item counts across jobs, not just a fraction', async () => {
    vi.mocked(girderRest.get).mockImplementation(async (url: string) => ({
      data: url === 'job/a'
        ? { status: SUCCESS, progress: { current: 900, total: 900 } }
        : { status: RUNNING, progress: { current: 100, total: 300 } },
    }));
    let polls = 0;
    vi.mocked(getFolder).mockImplementation(async () => {
      polls += 1;
      return { data: { meta: { annotate: polls > 1 } } } as never;
    });
    const onProgress = vi.fn();

    await waitForFolderDatasetReady(
      'folder',
      { pollIntervalMs: 1, timeoutMs: 1000, onProgress },
      ['a', 'b'],
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.closeTo((1 + 1 / 3) / 2, 5),
      { current: 1000, total: 1200 },
    );
  });
});
