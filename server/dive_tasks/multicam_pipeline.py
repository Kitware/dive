"""Helpers for running stereo and multicam VIAME pipelines on web datasets."""

from __future__ import annotations

import json
from pathlib import Path
import re
import shlex
from typing import Dict, List, Optional, Tuple

from dive_utils import constants
from dive_utils.types import MulticamCameraJob, MulticamRegistrationJob, PipelineDescription

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


def is_stereo_measurement_pipeline(pipeline: PipelineDescription) -> bool:
    return pipeline['type'] == constants.StereoPipelineMarker


def find_downloaded_calibration_file(directory: Path) -> Optional[Path]:
    """
    Locate a stereoscopic calibration file under directory after Girder download.

    Matches extensions allowed for web stereo calibration uploads.
    """
    matches: List[Path] = []
    for path in directory.rglob('*'):
        if path.is_file() and constants.stereoCalibrationRegex.search(path.name):
            matches.append(path.resolve())
    if not matches:
        return None
    return sorted(matches, key=lambda p: (len(p.parts), str(p)))[0]


def append_stereo_calibration_kwiver_settings(
    command: List[str],
    calibration_path: Path,
) -> None:
    """Append KWIVER settings used by desktop for stereoscopic calibration input."""
    cal_path = shlex.quote(str(calibration_path))
    command.append(f'-s measurer:calibration_file={cal_path}')
    command.append(f'-s calibration_reader:file={cal_path}')


def append_metadata_file_kwiver_settings(
    command: List[str],
    metadata_path: Path,
    kwiver_key: str,
) -> None:
    """
    Bind the dataset's optional metadata file to the KWIVER config key the pipe
    declared via its `# Metadata File:` header (e.g. stabilizer:flight_log).
    """
    command.append(f'-s {shlex.quote(kwiver_key)}={shlex.quote(str(metadata_path))}')


def pipeline_camera_order(camera_names: List[str], reference: str) -> List[str]:
    """
    Camera order for 2-cam/3-cam pipelines, matching the desktop client: the
    registration reference camera feeds input1 (the per-camera registrations
    all map onto the reference, and the pipes warp everything onto camera 1's
    frame), remaining cameras keep display order. Which detector a pipe runs
    on which input is the pipe's documented contract, not something DIVE
    infers.
    """
    if reference not in camera_names:
        return camera_names
    return [reference] + [name for name in camera_names if name != reference]


def build_registration_pairs(folder_meta: dict) -> List[dict]:
    """
    Convert a dataset folder's camera registration meta (cameraHomographies /
    cameraCorrespondences / cameraTransformTypes, keyed by directional
    "left::right") into dive-camera-registration file pairs.
    """
    homographies = folder_meta.get('cameraHomographies') or {}
    correspondences = folder_meta.get('cameraCorrespondences') or {}
    transform_types = folder_meta.get('cameraTransformTypes') or {}
    keys = set(homographies) | set(correspondences) | set(transform_types)
    pairs: List[dict] = []
    for key in sorted(keys):
        left, _, right = key.partition('::')
        homography = homographies.get(key)
        pairs.append(
            {
                'left': left,
                'right': right,
                'points': [
                    [c['a'][0], c['a'][1], c['b'][0], c['b'][1]]
                    for c in correspondences.get(key) or []
                ],
                'leftToRight': homography.get('AtoB') if homography else None,
                'rightToLeft': homography.get('BtoA') if homography else None,
                'transformType': transform_types.get(key, 'similarity'),
            }
        )
    return pairs


def build_registration_kwiver_settings(
    work_dir: Path,
    cameras: List[MulticamCameraJob],
    registration: MulticamRegistrationJob,
) -> Dict[str, str]:
    """
    Build the -s settings handing the camera registration to a 2-cam/3-cam
    pipeline. One standard <camera>_to_<reference>_registration.json per
    non-reference camera is written into the work dir; each camera's warp
    process (warp2, warp3, ... matching the job camera order) gets its own
    single-pair file. The pair and direction are still pinned via the
    reader's from_camera/to_camera config, since a pair may be stored in
    either orientation.

    Only pairs registering a camera directly onto the reference are
    supported: pairs between two non-reference cameras are explicitly
    unsupported here (there is no transform composition) and never reach the
    pipeline. Cameras without a fitted reference pair get no settings.
    """
    reference = registration.get('reference')
    if not reference:
        return {}
    reference_pairs = [
        pair
        for pair in registration.get('pairs') or []
        if reference in (pair['left'], pair['right']) and pair['left'] != pair['right']
    ]
    pairs_by_camera: Dict[str, List[dict]] = {}
    for pair in reference_pairs:
        camera = pair['left'] if pair['right'] == reference else pair['right']
        pairs_by_camera.setdefault(camera, []).append(pair)
    fitted = {
        (pair['left'], pair['right'])
        for pair in reference_pairs
        if pair.get('leftToRight') or pair.get('rightToLeft')
    }
    settings: Dict[str, str] = {}
    for index, camera in enumerate(cameras):
        name = camera['name']
        if index == 0 or name == reference:
            continue
        if (name, reference) not in fitted and (reference, name) not in fitted:
            continue
        camera_pairs = pairs_by_camera.get(name)
        if not camera_pairs:
            continue
        registration_path = work_dir / f'{name}_to_{reference}_registration.json'
        with open(registration_path, 'w', encoding='utf-8') as registration_file:
            json.dump(
                {'type': 'dive-camera-registration', 'version': 1, 'pairs': camera_pairs},
                registration_file,
                indent=2,
            )
        warp = f'warp{index + 1}'
        settings[f'{warp}:transformation_file'] = str(registration_path)
        settings[f'{warp}:transform_reader:type'] = 'dive'
        settings[f'{warp}:transform_reader:dive:from_camera'] = name
        settings[f'{warp}:transform_reader:dive:to_camera'] = reference
    return settings


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
