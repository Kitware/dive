import {
  describe, expect, it, vi,
} from 'vitest';
import createReviewRequestQueue from './requestQueue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('review request queue', () => {
  it('bounds overlapping requests and continues after errors', async () => {
    const queue = createReviewRequestQueue(2);
    const gates = [deferred(), deferred(), deferred()];
    const calls = gates.map((gate) => vi.fn(() => gate.promise));
    const results = calls.map((call) => queue.run(call));
    await Promise.resolve();
    expect(calls.map((call) => call.mock.calls.length)).toEqual([1, 1, 0]);
    gates[0].resolve();
    await results[0];
    await vi.waitFor(() => expect(calls[2]).toHaveBeenCalledOnce());
    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(results);
    await expect(queue.run(async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    await expect(queue.run(async () => 42)).resolves.toBe(42);
  });

  it('rejects queued and future requests without starting their I/O after disposal', async () => {
    const queue = createReviewRequestQueue(1);
    const gate = deferred();
    const active = queue.run(() => gate.promise);
    await Promise.resolve();
    const call = vi.fn(async () => 1);
    const pending = queue.run(call);
    const rejected = expect(pending).rejects.toThrow('disposed');
    queue.dispose();
    await rejected;
    await expect(queue.run(call)).rejects.toThrow('disposed');
    expect(call).not.toHaveBeenCalled();
    gate.resolve();
    await active;
  });
});
