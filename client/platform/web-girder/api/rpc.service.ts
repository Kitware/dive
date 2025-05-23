import girderRest from 'platform/web-girder/plugins/girder';
import type { GirderModel } from '@girder/components/src';
import { Pipe } from 'dive-common/apispec';

function postProcess(folderId: string, skipJobs = false, skipTranscoding = false, additive = false, additivePrepend = '', set: string | undefined = undefined) {
  return girderRest.post<[GirderModel, string[]]>(`dive_rpc/postprocess/${folderId}`, null, {
    params: {
      skipJobs, skipTranscoding, additive, additivePrepend, set,
    },
  });
}

function runPipeline(itemId: string, pipeline: Pipe) {
  return girderRest.post('dive_rpc/pipeline', null, {
    params: {
      folderId: itemId,
      pipeline,
    },
  });
}

function runTraining(
  folderIds: string[],
  pipelineName: string,
  config: string,
  annotatedFramesOnly: boolean,
  labelText?: string,
) {
  return girderRest.post('dive_rpc/train', { folderIds, labelText }, {
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
