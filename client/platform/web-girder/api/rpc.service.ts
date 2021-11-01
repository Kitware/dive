import girderRest from 'platform/web-girder/plugins/girder';
import { Pipe } from 'dive-common/apispec';

function postProcess(folderId: string, skipJobs = false) {
  return girderRest.post(`dive_rpc/postprocess/${folderId}`, null, {
    params: { skipJobs },
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
  labelText: string | null,
  config: string,
  annotatedFramesOnly: boolean,
) {
  return girderRest.post('dive_rpc/train', folderIds, {
    params: {
      pipelineName, labelText, config, annotatedFramesOnly,
    },
  });
}

export {
  postProcess,
  runPipeline,
  runTraining,
};
