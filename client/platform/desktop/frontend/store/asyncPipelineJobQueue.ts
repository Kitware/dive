import { RunPipeline } from 'platform/desktop/constants';
import AsyncJobQueue from './asyncJobQueue';

export default class PipelineJobQueue extends AsyncJobQueue<RunPipeline> {
  async beginJob(spec: RunPipeline) {
    const newJob = await this.ipcRenderer.invoke('run-pipeline', spec);
    this.processingJobs.push(newJob);
  }
}
