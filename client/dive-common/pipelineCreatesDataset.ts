import type { Pipe } from 'dive-common/apispec';
import { pipelineCreatesDatasetMarkers } from 'dive-common/constants';

/** Stereo pipe that writes disparity/depth images as a new image-sequence dataset. */
export const DISPARITY_IMAGE_PIPELINE = 'measurement_compute_rectified_disparity.pipe';

/**
 * True when a pipeline produces a new dataset (filter / transcode / disparity).
 *
 * Pipes with a camera suffix (e.g. filter_register_frames_2-cam.pipe) are
 * categorized under '2-cam'/'3-cam' rather than by their filename prefix, so
 * recognition uses both the resolved type and the pipe filename.
 */
export function pipelineCreatesNewDataset(
  pipeline: Pick<Pipe, 'type' | 'pipe'>,
): boolean {
  if (isDisparityImagePipeline(pipeline)) {
    return true;
  }
  return pipelineCreatesDatasetMarkers.includes(pipeline.type)
    || pipelineCreatesDatasetMarkers.some((marker) => pipeline.pipe.startsWith(`${marker}_`));
}

/** True when a pipeline is a filter pipe (including multicam filter_*_N-cam). */
export function isFilterPipeline(pipeline: Pick<Pipe, 'type' | 'pipe'>): boolean {
  return pipeline.type === 'filter' || pipeline.pipe.startsWith('filter_');
}

/** True when a pipeline is a transcode pipe (including multicam transcode_*_N-cam). */
export function isTranscodePipeline(pipeline: Pick<Pipe, 'type' | 'pipe'>): boolean {
  return pipeline.type === 'transcode' || pipeline.pipe.startsWith('transcode_');
}

/**
 * True for measurement_compute_rectified_disparity.pipe — produces depth-map
 * images that should become a new dataset (not CSV annotations).
 */
export function isDisparityImagePipeline(pipeline: Pick<Pipe, 'pipe'>): boolean {
  return pipeline.pipe === DISPARITY_IMAGE_PIPELINE;
}
