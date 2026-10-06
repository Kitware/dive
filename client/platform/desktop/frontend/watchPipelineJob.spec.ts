/**
 * Completion by job state on desktop.
 *
 * The interesting case is a job that is already finished in the history when
 * the watch starts: it settles on watch()'s own immediate pass, before the
 * stop handle exists, so the watcher has to be torn down by the caller instead.
 */

import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';
import type { Ref } from 'vue';

// The factory pulls `ref` from the real module so the fixture shares one
// reactivity system with the `watch` inside api.ts; a separately-created ref
// never notifies it.
vi.mock('./store/jobs', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue');
  return {
    jobHistory: ref({}),
    gpuJobQueue: { enqueue: () => undefined },
    cpuJobQueue: { enqueue: () => undefined },
  };
});

// eslint-disable-next-line import/first
import { jobHistory } from './store/jobs';
// eslint-disable-next-line import/first
import { watchPipelineJob } from './api';

type Fixture = Record<string, { job: Record<string, unknown> }>;
const history = jobHistory as unknown as Ref<Fixture>;

const PIPE = { name: 'Align', pipe: 'utility_align_cameras_2-cam.pipe', type: 'utility' };

function pipelineJob(overrides: Record<string, unknown> = {}) {
  return {
    key: 'job1',
    jobType: 'pipeline',
    args: { pipeline: PIPE },
    datasetIds: ['ds1'],
    startTime: new Date().toISOString(),
    ...overrides,
  };
}

/** Let the watcher's queued flush run. */
function flush() {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

describe('watchPipelineJob', () => {
  beforeEach(() => {
    history.value = {};
  });

  it('settles on the immediate pass when a matching job has already ended', async () => {
    // This is the only shape that settles inside watch()'s own immediate run,
    // when the stop handle is still undefined: the matcher ignores anything
    // that started before the watch, so the job has to share its start instant
    // AND already be over. Freeze the clock, since otherwise the millisecond
    // ticks between building the fixture and the call and the job reads stale.
    vi.useFakeTimers();
    try {
      const now = new Date();
      vi.setSystemTime(now);
      history.value = {
        job1: {
          job: pipelineJob({
            startTime: now.toISOString(),
            endTime: now.toISOString(),
            exitCode: 0,
          }),
        },
      };

      await expect(watchPipelineJob('ds1', PIPE)).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a nonzero exit with its code', async () => {
    const pending = watchPipelineJob('ds1', PIPE);
    history.value = {
      job1: { job: pipelineJob({ endTime: new Date().toISOString(), exitCode: 2 }) },
    };

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.message).toContain('code 2');
  });

  it('names cancellation as its own outcome', async () => {
    const pending = watchPipelineJob('ds1', PIPE);
    history.value = {
      job1: {
        job: pipelineJob({
          endTime: new Date().toISOString(),
          exitCode: 143,
          cancelledJob: true,
        }),
      },
    };

    await expect(pending).resolves.toEqual({
      ok: false,
      message: 'The job was cancelled.',
    });
  });

  it('ignores a job that started before the watch', async () => {
    const stale = new Date(Date.now() - 60_000).toISOString();
    const pending = watchPipelineJob('ds1', PIPE);
    let settled = false;
    pending.then(() => { settled = true; }).catch(() => undefined);

    history.value = {
      old: {
        job: pipelineJob({
          key: 'old', startTime: stale, endTime: stale, exitCode: 0,
        }),
      },
    };
    await flush();
    expect(settled).toBe(false);
  });

  it('stays pending while the job is still running', async () => {
    const pending = watchPipelineJob('ds1', PIPE);
    let settled = false;
    pending.then(() => { settled = true; }).catch(() => undefined);

    history.value = { job1: { job: pipelineJob() } };
    await flush();
    expect(settled).toBe(false);
  });
});
