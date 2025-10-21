import { DesktopJob, DesktopJobUpdate, JobArgs } from 'platform/desktop/constants';

export default abstract class AsyncJobQueue<T extends JobArgs> {
  jobSpecs: T[];

  processingJob: null | DesktopJob;

  waiting: boolean;

  ipcRenderer: Electron.IpcRenderer;

  constructor(ipcRenderer: Electron.IpcRenderer) {
    this.jobSpecs = [];
    this.processingJob = null;
    this.waiting = false;
    this.ipcRenderer = ipcRenderer;

    this.init();
  }

  init() {
    this.ipcRenderer.on('job-update', (event, args: DesktopJobUpdate) => {
      this.processJob(args);
    });
  }

  async enqueue(jobSpec: T) {
    this.jobSpecs.push(jobSpec);
    await this.dequeue();
  }

  async dequeue() {
    if (this.processingJob || this.waiting) return;
    this.waiting = true;
    const nextSpec = this.jobSpecs.shift();
    if (!nextSpec) return;

    await this.beginJob(nextSpec);
    this.waiting = false;
  }

  abstract beginJob(spec: T): Promise<void>;

  processJob(update: DesktopJobUpdate) {
    if (!this.processingJob) return;
    if (update.key !== this.processingJob.key) return;
    if (update.endTime) {
      this.finishJob();
    }
  }

  async finishJob() {
    this.processingJob = null;
    await this.dequeue();
  }

  length(): number {
    return this.jobSpecs.length;
  }
}
