/** Bound outstanding review API operations, including calls from overlapping loads. */
export default function createReviewRequestQueue(concurrency = 3) {
  let active = 0;
  let disposed = false;
  const waiting: Array<() => void> = [];

  function pump() {
    while (active < concurrency && waiting.length) waiting.shift()!();
  }

  function run<T>(task: () => Promise<T>): Promise<T> {
    if (disposed) return Promise.reject(new Error('Review session disposed'));
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        if (disposed) {
          reject(new Error('Review session disposed'));
          return;
        }
        active += 1;
        Promise.resolve().then(() => {
          if (disposed) throw new Error('Review session disposed');
          return task();
        }).then(resolve, reject).finally(() => {
          active -= 1;
          pump();
        });
      });
      pump();
    });
  }

  function dispose() {
    disposed = true;
    // Reject queued work immediately; in-flight requests finish without starting more I/O.
    waiting.splice(0).forEach((start) => start());
  }

  return { run, dispose };
}
