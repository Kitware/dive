import girderRest from 'platform/web-girder/plugins/girder';
import type { GirderModel } from '@girder/components/src';
import {
  Pipe, SegmentationPredictRequest, SegmentationPredictResponse, SegmentationStatusResponse,
  TextQueryRequest, TextQueryResponse,
} from 'dive-common/apispec';

function postProcess(folderId: string, skipJobs = false, skipTranscoding = false, additive = false, additivePrepend = '', set: string | undefined = undefined) {
  return girderRest.post<{folder: GirderModel, warnings: string[], job_ids: string[]}>(`dive_rpc/postprocess/${folderId}`, null, {
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

/**
 * Interactive Segmentation API
 */

async function segmentationPredict(
  folderId: string,
  frameNumber: number,
  request: SegmentationPredictRequest,
): Promise<SegmentationPredictResponse> {
  const { data } = await girderRest.post<SegmentationPredictResponse>('dive_rpc/segmentation_predict', {
    points: request.points,
    pointLabels: request.pointLabels,
    maskInput: request.maskInput,
    multimaskOutput: request.multimaskOutput,
  }, {
    params: {
      folderId,
      frameNumber,
    },
  });
  return data;
}

async function segmentationStatus(): Promise<SegmentationStatusResponse> {
  const { data } = await girderRest.get<SegmentationStatusResponse>('dive_rpc/segmentation_status');
  return data;
}

/**
 * Initialize segmentation service by checking availability.
 * Throws an error if segmentation is not available on the server.
 */
async function segmentationInitialize(): Promise<void> {
  const status = await segmentationStatus();
  if (!status.available) {
    throw new Error("Model failed to load. If you haven't downloaded the SAM2 model pack from the VIAME Add-On wiki, please do so.");
  }
}

/**
 * Text Query API for open-vocabulary detection/segmentation
 */

async function textQuery(
  folderId: string,
  frameNumber: number,
  request: Omit<TextQueryRequest, 'imagePath'>,
): Promise<TextQueryResponse> {
  const { data } = await girderRest.post<TextQueryResponse>('dive_rpc/text_query', {
    text: request.text,
    boxThreshold: request.boxThreshold,
    maxDetections: request.maxDetections,
  }, {
    params: {
      folderId,
      frameNumber,
    },
  });
  return data;
}

async function textQueryStatus(): Promise<{ available: boolean; grounding_available: boolean }> {
  const { data } = await girderRest.get<{ available: boolean; loaded: boolean; text_query_available: boolean }>('dive_rpc/segmentation_status');
  return {
    available: data.available,
    grounding_available: data.text_query_available,
  };
}

export {
  convertLargeImage,
  postProcess,
  runPipeline,
  runTraining,
  deleteTrainedPipeline,
  exportTrainedPipeline,
  segmentationPredict,
  segmentationStatus,
  segmentationInitialize,
  textQuery,
  textQueryStatus,
};
