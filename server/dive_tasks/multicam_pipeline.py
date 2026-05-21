"""Helpers for running stereo and multicam VIAME pipelines on web datasets."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from dive_utils import constants
from dive_utils.types import MulticamCameraJob, PipelineDescription

_PIPELINE_INPUT_PATTERN = re.compile(r'utility_|filter_|transcode_|measurement_')


def pipeline_requires_input(pipeline: PipelineDescription) -> bool:
    """True when the pipe needs existing detections/tracks as input (matches desktop)."""
    return bool(_PIPELINE_INPUT_PATTERN.search(pipeline['pipe']))


def is_stereo_or_multicam_pipeline(pipeline: PipelineDescription) -> bool:
    pipeline_type = pipeline['type']
    return (
        pipeline_type == constants.StereoPipelineMarker
        or pipeline_type in constants.MultiCamPipelineMarkers
    )


def build_multicam_kwiver_settings(
    work_dir: Path,
    cameras: List[MulticamCameraJob],
    camera_media: Dict[str, Tuple[List[str], str]],
    *,
    requires_input: bool = False,
) -> Tuple[Dict[str, str], Dict[str, str]]:
    """
    Build KWIVER -s key/value pairs for per-camera inputs/outputs.

    Returns (arg_file_pair, out_files) where out_files maps camera name -> output csv basename.
    """
    arg_file_pair: Dict[str, str] = {}
    out_files: Dict[str, str] = {}

    for i, camera in enumerate(cameras):
        key = camera['name']
        media_list, media_type = camera_media[key]
        output_file_name = f'computed_tracks_{key}.csv'
        output_arg = f'detector_writer{i + 1}:file_name'
        output_arg_tracks = f'track_writer{i + 1}:file_name'
        arg_file_pair[output_arg] = output_file_name
        arg_file_pair[output_arg_tracks] = output_file_name
        out_files[key] = output_file_name

        input_arg = f'input{i + 1}:video_filename'
        if i == 0:
            arg_file_pair['detector_writer:file_name'] = output_file_name
            arg_file_pair['track_writer:file_name'] = output_file_name

        if media_type == constants.ImageSequenceType:
            input_file_name = str(work_dir / f'input{i + 1}_images.txt')
            with open(input_file_name, 'w', encoding='utf-8') as img_list_file:
                img_list_file.write('\n'.join(media_list))
            arg_file_pair[input_arg] = input_file_name
            if i == 0:
                arg_file_pair['input:video_filename'] = input_file_name
        elif media_type == constants.VideoType:
            assert len(media_list) == 1, 'Expected exactly one video per camera'
            arg_file_pair[f'input{i + 1}:video_reader:type'] = 'vidl_ffmpeg'
            arg_file_pair[input_arg] = media_list[0]
            if i == 0:
                arg_file_pair['input:video_filename'] = media_list[0]
        else:
            raise ValueError(f'Unsupported camera media type: {media_type}')

        if requires_input:
            detection_arg = f'detection_reader{i + 1}:file_name'
            track_arg = f'track_reader{i + 1}:file_name'
            ground_truth_name = str(work_dir / f'detections{i + 1}.csv')
            arg_file_pair[detection_arg] = ground_truth_name
            arg_file_pair[track_arg] = ground_truth_name
            if i == 0:
                arg_file_pair['detection_reader:file_name'] = ground_truth_name
                arg_file_pair['track_reader:file_name'] = ground_truth_name

    return arg_file_pair, out_files
