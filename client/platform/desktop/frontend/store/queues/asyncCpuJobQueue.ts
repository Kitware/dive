import {
  JobType,
  ConversionArgs,
  ExportTrainedPipeline,
  RunScoring,
  DesktopJob,
} from 'platform/desktop/constants';
import type { ScoringPair, ScoringSource } from 'dive-common/scoring/types';
import AsyncJobQueue from './asyncJobQueue';

type CpuJob = ConversionArgs | ExportTrainedPipeline | RunScoring;

function sameScoringSource(a: ScoringSource, b: ScoringSource) {
  return a.datasetId === b.datasetId && a.file === b.file && a.set === b.set && a.revision === b.revision;
}

function sameScoringPairs(a: ScoringPair[], b: ScoringPair[]) {
  return a.length === b.length && a.every((pair, i) => (
    sameScoringSource(pair.computed, b[i].computed) && sameScoringSource(pair.truth, b[i].truth)
  ));
}

export default class AsyncCpuJobQueue extends AsyncJobQueue<CpuJob> {
  async beginJob(spec: CpuJob) {
    let newJob: DesktopJob;
    if (spec.type === JobType.Conversion) {
      newJob = await this.ipcRenderer.invoke<DesktopJob>('convert', spec);
    } else if (spec.type === JobType.ExportTrainedPipeline) {
      newJob = await this.ipcRenderer.invoke<DesktopJob>('export-trained-pipeline', spec);
    } else if (spec.type === JobType.RunScoring) {
      newJob = await this.ipcRenderer.invoke<DesktopJob>('run-scoring', spec);
    } else {
      throw new Error('CPU job type not able to be queued');
    }
    this.processingJobs.push(newJob);
  }

  removeJobFromQueue(removeSpec: CpuJob): void {
    let removeSpecIndex = -1;
    if (removeSpec.type === JobType.Conversion) {
      removeSpecIndex = this.jobSpecs.findIndex((spec: CpuJob) => (
        spec.type === JobType.Conversion
        && spec.meta.id === removeSpec.meta.id));
    } else if (removeSpec.type === JobType.ExportTrainedPipeline) {
      removeSpecIndex = this.jobSpecs.findIndex((spec: CpuJob) => (spec.type === JobType.ExportTrainedPipeline
        && (spec.path !== removeSpec.path && spec.pipeline.pipe !== removeSpec.pipeline.pipe)
      ));
    } else if (removeSpec.type === JobType.RunScoring) {
      removeSpecIndex = this.jobSpecs.findIndex((spec: CpuJob) => (spec.type === JobType.RunScoring
        && sameScoringPairs(spec.pairs, removeSpec.pairs)
      ));
    }
    if (removeSpecIndex !== -1) {
      this.jobSpecs.splice(removeSpecIndex, 1);
    }
  }
}
