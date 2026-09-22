/**
 * Completion by job state on web.
 *
 * Without this, the Auto Register panel falls back to polling the registration
 * meta, which cannot see a failed job: the panel keeps reporting "job running"
 * until its 30 minute timeout.
 */

import {
  beforeEach, describe, expect, it,
} from 'vitest';
import { nextTick } from 'vue';

import { useJobs } from 'platform/web-girder/store/useJobs';
import watchPipelineJob from './watchPipelineJob';

const QUEUED = 1;
const RUNNING = 2;
const SUCCESS = 3;
const ERROR = 4;
const CANCELED = 5;

describe('watchPipelineJob', () => {
  const jobs = useJobs();

  beforeEach(() => {
    Object.keys(jobs.datasetStatus.value).forEach((key) => {
      delete jobs.datasetStatus.value[key];
    });
  });

  /** Drive the job through states, letting each one reach the watcher. */
  async function advance(datasetId: string, jobId: string, statuses: number[]) {
    // eslint-disable-next-line no-restricted-syntax
    for (const status of statuses) {
      jobs.setDatasetStatus({ datasetId, status, jobId });
      // eslint-disable-next-line no-await-in-loop
      await nextTick();
    }
  }

  it('resolves ok when the job succeeds', async () => {
    const pending = watchPipelineJob('ds1');
    await advance('ds1', 'job1', [QUEUED, RUNNING, SUCCESS]);

    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('resolves not-ok on failure instead of leaving the caller spinning', async () => {
    const pending = watchPipelineJob('ds1');
    await advance('ds1', 'job1', [RUNNING, ERROR]);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Jobs tab');
  });

  it('names cancellation as its own outcome', async () => {
    const pending = watchPipelineJob('ds1');
    await advance('ds1', 'job1', [RUNNING, CANCELED]);

    await expect(pending).resolves.toEqual({
      ok: false,
      message: 'The job was canceled.',
    });
  });

  it('ignores a job that had already finished when the watch started', async () => {
    // The store keeps one job per dataset, so the previous run's terminal state
    // is sitting there when the next run starts watching.
    await advance('ds1', 'old-job', [SUCCESS]);
    const pending = watchPipelineJob('ds1');
    let settled = false;
    pending.then(() => { settled = true; }).catch(() => undefined);
    await nextTick();
    expect(settled).toBe(false);

    await advance('ds1', 'new-job', [RUNNING, ERROR]);
    await expect(pending).resolves.toMatchObject({ ok: false });
  });

  it('waits when the dataset has no job yet', async () => {
    const pending = watchPipelineJob('ds2');
    let settled = false;
    pending.then(() => { settled = true; }).catch(() => undefined);
    await nextTick();
    expect(settled).toBe(false);

    await advance('ds2', 'job1', [QUEUED, SUCCESS]);
    await expect(pending).resolves.toEqual({ ok: true });
  });
});
