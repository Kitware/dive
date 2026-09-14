import girderRest from 'platform/web-girder/plugins/girder';
import type { GirderModel } from '@girder/components/src';
import type { Pipe, PipelineParams } from 'dive-common/apispec';
import { resolveDatasetFolderId } from './multicamResolve';

function postProcess(folderId: string, skipJobs = false, skipTranscoding = false, additive = false, additivePrepend = '', set: string | undefined = undefined) {
  return girderRest.post<{folder: GirderModel, warnings: string[], job_ids: string[]}>(`dive_rpc/postprocess/${folderId}`, null, {
    params: {
      skipJobs, skipTranscoding, additive, additivePrepend, set,
    },
  });
}

async function runPipeline(itemId: string, pipeline: Pipe, pipelineParams?: PipelineParams) {
  // Composite multicam ids (parent/camera) resolve to the camera folder so
  // single-camera pipelines can run on the selected camera.
  const { folderId } = await resolveDatasetFolderId(itemId);
  const params: Record<string, unknown> = {
    folderId,
    pipeline,
  };
  if (pipelineParams) {
    params.pipelineParams = pipelineParams;
  }
  return girderRest.post('dive_rpc/pipeline', null, { params });
}

function runTraining(
  folderIds: string[],
  pipelineName: string,
  config: string,
  annotatedFramesOnly: boolean,
  labelText?: string,
  fineTuneModel?: {
    name: string;
    type: string;
    path?: string;
    folderId?: string;
  },
) {
  return girderRest.post('dive_rpc/train', { folderIds, labelText, fineTuneModel }, {
    params: {
      pipelineName, config, annotatedFramesOnly,
    },
  });
}

function deleteTrainedPipeline(pipeline: Pipe) {
  return girderRest.delete(`folder/${pipeline.folderId}`);
}

function exportTrainedPipeline(path: string, pipeline: Pipe) {
  return girderRest.post('dive_rpc/export', null, {
    params: {
      modelFolderId: pipeline.folderId,
      exportFolderId: path,
    },
  });
}

function convertLargeImage(folderId: string) {
  return girderRest.post(`dive_rpc/convert_large_image/${folderId}`, null, {});
}

export {
  convertLargeImage,
  postProcess,
  runPipeline,
  runTraining,
  deleteTrainedPipeline,
  exportTrainedPipeline,
};
