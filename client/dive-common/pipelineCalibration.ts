import type { Pipe } from 'dive-common/apispec';

export const calibrationRequiredPipelineMessage = (
  'This pipeline requires a calibration file. Import or attach a calibration file to the dataset.'
);

/** True only when the pipe file declares `# Requires Calibration: True`. */
export function pipelineRequiresCalibration(pipeline: Pipe): boolean {
  return pipeline.metadata?.requiresCalibration === true;
}

export function pipelineDisabledForMissingCalibration(
  pipeline: Pipe,
  calibrationAvailableByDatasetId: Record<string, boolean | undefined>,
  selectedDatasetIds: string[],
): boolean {
  if (!pipelineRequiresCalibration(pipeline) || !selectedDatasetIds.length) {
    return false;
  }
  return selectedDatasetIds.some((datasetId) => !calibrationAvailableByDatasetId[datasetId]);
}
