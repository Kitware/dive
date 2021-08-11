import girderRest from 'platform/web-girder/plugins/girder';
import { Pipe } from 'dive-common/apispec';

function postProcess(folderId: string) {
  return girderRest.post(`dive_rpc/postprocess/${folderId}`);
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
  folderIds: string[], pipelineName: string, config: string, annotatedFramesOnly: boolean,
) {
  return girderRest.post('dive_rpc/train', folderIds, {
    params: { pipelineName, config, annotatedFramesOnly },
  });
}

export {
  postProcess,
  runPipeline,
  runTraining,
};
