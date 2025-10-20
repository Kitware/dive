import { DesktopJob } from 'platform/desktop/constants';

export default class AsyncJobQueue {
  queue: Promise<DesktopJob>[];

  processing: boolean;

  constructor() {
    this.queue = [];
    this.processing = false;
  }

  enqueue(job: Promise<DesktopJob>): void {
    this.queue.push(job);
    this.dequeue();
  }

  dequeue() {
    if (!this.processing) {
      this.processing = true;
    }
  }
}
