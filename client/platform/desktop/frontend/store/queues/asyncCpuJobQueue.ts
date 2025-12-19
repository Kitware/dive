import {
  JobType,
  ConversionArgs,
  ExportTrainedPipeline,
  DesktopJob,
} from 'platform/desktop/constants';
import AsyncJobQueue from './asyncJobQueue';

export default class AsyncCpuJobQueue extends AsyncJobQueue<ConversionArgs | ExportTrainedPipeline> {
  async beginJob(spec: ConversionArgs | ExportTrainedPipeline) {
    let newJob: DesktopJob;
    if (spec.type === JobType.Conversion) {
      newJob = await this.ipcRenderer.invoke('convert', spec);
    } else if (spec.type === JobType.ExportTrainedPipeline) {
      newJob = await this.ipcRenderer.invoke('export-trained-pipeline', spec);
    } else {
      throw new Error('CPU job type not able to be queued');
    }
    this.processingJobs.push(newJob);
  }

  removeJobFromQueue(removeSpec: ConversionArgs | ExportTrainedPipeline): void {
    let removeSpecIndex = -1;
    if (removeSpec.type === JobType.Conversion) {
      removeSpecIndex = this.jobSpecs.findIndex((spec: ConversionArgs | ExportTrainedPipeline) => (
        spec.type === JobType.Conversion
        && spec.meta.id === removeSpec.meta.id));
    } else if (removeSpec.type === JobType.ExportTrainedPipeline) {
      removeSpecIndex = this.jobSpecs.findIndex((spec: ConversionArgs | ExportTrainedPipeline) => (spec.type === JobType.ExportTrainedPipeline
        && (spec.path !== removeSpec.path && spec.pipeline.pipe !== removeSpec.pipeline.pipe)
      ));
    }
    if (removeSpecIndex !== -1) {
      this.jobSpecs.splice(removeSpecIndex, 1);
    }
  }
}
