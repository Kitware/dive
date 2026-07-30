import type { Pipe } from 'dive-common/apispec';
import { pipelineCreatesDatasetMarkers } from 'dive-common/constants';

/**
 * True when a pipeline produces a new dataset (filter / transcode).
 *
 * Pipes with a camera suffix (e.g. filter_register_frames_2-cam.pipe) are
 * categorized under '2-cam'/'3-cam' rather than by their filename prefix, so
 * recognition uses both the resolved type and the pipe filename.
 */
export function pipelineCreatesNewDataset(
  pipeline: Pick<Pipe, 'type' | 'pipe'>,
): boolean {
  return pipelineCreatesDatasetMarkers.includes(pipeline.type)
    || pipelineCreatesDatasetMarkers.some((marker) => pipeline.pipe.startsWith(`${marker}_`));
}

/** True when a pipeline is a filter pipe (including multicam filter_*_N-cam). */
export function isFilterPipeline(pipeline: Pick<Pipe, 'type' | 'pipe'>): boolean {
  return pipeline.type === 'filter' || pipeline.pipe.startsWith('filter_');
}
