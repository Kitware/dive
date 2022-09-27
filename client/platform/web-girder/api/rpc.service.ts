import girderRest from 'platform/web-girder/plugins/girder';
import { Pipe } from 'dive-common/apispec';

function postProcess(folderId: string, skipJobs = false, skipTranscoding = false) {
  return girderRest.post(`dive_rpc/postprocess/${folderId}`, null, {
    params: { skipJobs, skipTranscoding },
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

export {
  postProcess,
  runPipeline,
  runTraining,
};
