import {
  JobType,
  RunPipeline,
  RunTraining,
  DesktopJob,
} from 'platform/desktop/constants';
import AsyncJobQueue from './asyncJobQueue';

export default class AsyncGpuJobQueue extends AsyncJobQueue<RunPipeline | RunTraining> {
  async beginJob(spec: RunPipeline | RunTraining) {
    let newJob: DesktopJob;
    if (spec.type === JobType.RunPipeline) {
      newJob = await this.ipcRenderer.invoke('run-pipeline', spec);
    } else if (spec.type === JobType.RunTraining) {
      newJob = await this.ipcRenderer.invoke('run-training', spec);
    } else {
      throw new Error('Unsupported job arguments provided to beginJob.');
    }
    this.processingJobs.push(newJob);
  }
}
