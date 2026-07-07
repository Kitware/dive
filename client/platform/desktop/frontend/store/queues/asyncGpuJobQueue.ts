import {
  JobType,
  RunPipeline,
  RunTraining,
  BuildSearchIndex,
  DesktopJob,
} from 'platform/desktop/constants';
import AsyncJobQueue from './asyncJobQueue';

function runTrainingsAreEquivalent(a: RunTraining, b: RunTraining) {
  const sameSet = (setA: Set<string>, setB: Set<string>) => {
    const sameSize = setA.size === setB.size;
    const sameElements = [...setA].every((element: string) => setB.has(element));
    return sameSize && sameElements;
  };
  const sameDatasets = sameSet(new Set(a.datasetIds), new Set(b.datasetIds));
  return (
    sameDatasets
    && a.pipelineName === b.pipelineName
    && a.trainingConfig === b.trainingConfig
    && a.annotatedFramesOnly === b.annotatedFramesOnly
    && a.labelText === b.labelText
    && a.fineTuneModel?.name === b.fineTuneModel?.name
  );
}

type GpuJobSpec = RunPipeline | RunTraining | BuildSearchIndex;

export default class AsyncGpuJobQueue extends AsyncJobQueue<GpuJobSpec> {
  async beginJob(spec: GpuJobSpec) {
    let newJob: DesktopJob;
    if (spec.type === JobType.RunPipeline) {
      newJob = await this.ipcRenderer.invoke('run-pipeline', spec);
    } else if (spec.type === JobType.RunTraining) {
      newJob = await this.ipcRenderer.invoke('run-training', spec);
    } else if (spec.type === JobType.BuildSearchIndex) {
      newJob = await this.ipcRenderer.invoke('video-search-build-index', spec);
    } else {
      throw new Error('Unsupported job arguments provided to beginJob.');
    }
    this.processingJobs.push(newJob);
  }

  removeJobFromQueue(removeSpec: GpuJobSpec): void {
    let removeSpecIndex = -1;
    if (removeSpec.type === JobType.RunPipeline) {
      removeSpecIndex = this.jobSpecs.findIndex((spec: GpuJobSpec) => (spec.type === JobType.RunPipeline
        && spec.datasetId === removeSpec.datasetId
        && spec.pipeline.pipe === removeSpec.pipeline.pipe
      ));
    } else if (removeSpec.type === JobType.RunTraining) {
      removeSpecIndex = this.jobSpecs.findIndex((spec: GpuJobSpec) => (spec.type === JobType.RunTraining
        && runTrainingsAreEquivalent(spec, removeSpec)
      ));
    } else if (removeSpec.type === JobType.BuildSearchIndex) {
      removeSpecIndex = this.jobSpecs.findIndex((spec: GpuJobSpec) => (spec.type === JobType.BuildSearchIndex
        && spec.datasetId === removeSpec.datasetId
      ));
    }
    if (removeSpecIndex > -1) {
      this.jobSpecs.splice(removeSpecIndex, 1);
    }
  }
}
