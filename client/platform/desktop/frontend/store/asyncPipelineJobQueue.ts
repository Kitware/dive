import { RunPipeline } from 'platform/desktop/constants';
import AsyncJobQueue from './asyncJobQueue';

export default class PipelineJobQueue extends AsyncJobQueue<RunPipeline> {
  async beginJob(spec: RunPipeline) {
    this.processingJob = await this.ipcRenderer.invoke('run-pipeline', spec);
  }
}
