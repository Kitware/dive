"""Identify pipelines that produce a new media dataset (filter / transcode / disparity)."""

from __future__ import annotations

from pathlib import Path
import shlex
from typing import List, Optional

from dive_utils.types import PipelineDescription

# Markers matching client dive-common/constants.pipelineCreatesDatasetMarkers
PIPELINE_CREATES_DATASET_MARKERS = ('transcode', 'filter')

# Stereo pipe that writes disparity/depth images as a new image-sequence dataset.
DISPARITY_IMAGE_PIPELINE = 'measurement_compute_rectified_disparity.pipe'


def is_disparity_image_pipeline(pipeline: PipelineDescription) -> bool:
    """True for measurement_compute_rectified_disparity.pipe."""
    return pipeline.get('pipe') == DISPARITY_IMAGE_PIPELINE


def is_filter_pipeline(pipeline: PipelineDescription) -> bool:
    """True for filter pipes, including multicam filter_*_N-cam."""
    pipe = pipeline.get('pipe') or ''
    return pipeline.get('type') == 'filter' or pipe.startswith('filter_')


def is_transcode_pipeline(pipeline: PipelineDescription) -> bool:
    """True for transcode pipes, including multicam transcode_*_N-cam."""
    pipe = pipeline.get('pipe') or ''
    return pipeline.get('type') == 'transcode' or pipe.startswith('transcode_')


def pipeline_creates_new_dataset(pipeline: PipelineDescription) -> bool:
    """
    True when a pipeline produces a new dataset (filter / transcode / disparity).

    Pipes with a camera suffix are categorized under '2-cam'/'3-cam', so
    recognition uses both the resolved type and the pipe filename.
    """
    if is_disparity_image_pipeline(pipeline):
        return True
    pipe = pipeline.get('pipe') or ''
    pipeline_type = pipeline.get('type') or ''
    if pipeline_type in PIPELINE_CREATES_DATASET_MARKERS:
        return True
    return any(pipe.startswith(f'{marker}_') for marker in PIPELINE_CREATES_DATASET_MARKERS)


def pipeline_renumbers_frames(pipeline_pipe: str) -> bool:
    """True when frame-range output should be renumbered (filter/transcode/disparity)."""
    return (
        pipeline_pipe.startswith(('transcode_', 'filter_'))
        or pipeline_pipe == DISPARITY_IMAGE_PIPELINE
    )


def append_new_dataset_media_writers(
    command: List[str],
    pipeline: PipelineDescription,
    output_path: Path,
    *,
    video_filename: Optional[str] = None,
) -> Optional[str]:
    """
    Append KWIVER -s overrides so filter/transcode/disparity write media into output_path.

    Returns the absolute transcoded video path when a video_writer is set, else None.
    """
    out_prefix = f'{output_path}/'
    if is_filter_pipeline(pipeline):
        command.append(f'-s kwa_writer:output_directory={shlex.quote(out_prefix)}')
        # Multicam filter pipes use image_writer / image_writer2 / image_writer3.
        command.append(f'-s image_writer:file_name_prefix={shlex.quote(out_prefix)}')
        command.append(f'-s image_writer2:file_name_prefix={shlex.quote(out_prefix)}')
        command.append(f'-s image_writer3:file_name_prefix={shlex.quote(out_prefix)}')

    if is_disparity_image_pipeline(pipeline):
        # Override the consuming key: $CONFIG{global:...} expands at parse time.
        template = str(output_path / 'map%06d.png')
        command.append(f'-s output:file_name_template={shlex.quote(template)}')

    if is_transcode_pipeline(pipeline):
        if not video_filename:
            video_filename = str(output_path / f"{pipeline.get('name', 'transcode')}_output.mp4")
        command.append(f'-s video_writer:video_filename={shlex.quote(video_filename)}')
        return video_filename
    return None
