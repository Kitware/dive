import {
  ConversionArgs,
  ExportTrainedPipeline,
  Settings,
  DesktopJobUpdater,
  JsonMeta,
} from 'platform/desktop/constants';
import { convertMedia } from 'platform/desktop/backend/native/mediaJobs';
import AsyncJobQueue from './asyncJobQueue';

export default class AsyncCpuJobQueue extends AsyncJobQueue<ConversionArgs | ExportTrainedPipeline> {
  async beginConversionJob(
    spec: ConversionArgs,
    settings: Settings,
    updater: DesktopJobUpdater,
    onComplete?: (jobKey: string, meta: JsonMeta) => void,
    mediaIndex = 0,
    key = '',
    baseWorkDir = '',
  ): JsonMeta {
    const result = await this.ipcRenderer.invoke('finalize-import')
    this.processingJobs.push(result.desk);
    return
  }

  async beginJob(spec: ExportTrainedPipeline) {
    const newJob = await this.ipcRenderer.invoke('export-trained-pipeline', spec);
    this.processingJobs.push(newJob);
  }
}
