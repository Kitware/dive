import { DesktopJob, DesktopJobUpdate, JobArgs } from 'platform/desktop/constants';

export default abstract class AsyncJobQueue<T extends JobArgs> {
  jobSpecs: T[];

  processingJobs: DesktopJob[];

  size: number;

  // Represents jobs that have been selected to start, but haven't actually started yet
  queued: number;

  private dequeueing = false;

  ipcRenderer: Electron.IpcRenderer;

  constructor(ipcRenderer: Electron.IpcRenderer, size: number = 1) {
    this.jobSpecs = [];
    this.processingJobs = [];
    this.queued = 0;
    this.ipcRenderer = ipcRenderer;
    this.size = size;

    this.init();
  }

  init() {
    this.ipcRenderer.on('job-update', (event, args: DesktopJobUpdate) => {
      this.processJob(args);
    });
  }

  async enqueue(jobSpec: T) {
    this.jobSpecs.push(jobSpec);
    this.dequeue();
  }

  async dequeue() {
    if (this.dequeueing) return;
    this.dequeueing = true;
    try {
      while (this.processingJobs.length + this.queued < this.size && this.jobSpecs.length > 0) {
        this.queued += 1;
        const nextSpec = this.jobSpecs.shift()!;
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.beginJob(nextSpec);
        } finally {
          this.queued -= 1;
        }
      }
    } finally {
      this.dequeueing = false;
    }
  }

  processJob(update: DesktopJobUpdate) {
    if (!this.processingJobs.length) return;
    const updatedJob = this.processingJobs.find((job: DesktopJob) => job.key === update.key);
    if (!updatedJob) return;
    if (update.endTime) {
      this.finishJob(update.key);
    }
  }

  async finishJob(finishedJobKey: string) {
    this.processingJobs = this.processingJobs.filter((job) => job.key !== finishedJobKey);
    await this.dequeue();
  }

  length(): number {
    return this.jobSpecs.length;
  }

  abstract beginJob(spec: T): Promise<void>;

  abstract removeJobFromQueue(spec: T): void;
}
