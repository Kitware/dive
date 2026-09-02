"""Helpers for running stereo and multicam VIAME pipelines on web datasets."""

from __future__ import annotations

import json
from pathlib import Path
import re
import shlex
import subprocess
from typing import Callable, Dict, List, Optional, Tuple

from dive_tasks.pipeline_creates_dataset import is_disparity_image_pipeline
from dive_utils import constants
from dive_utils.types import MulticamCameraJob, MulticamRegistrationJob, PipelineDescription

_PIPELINE_INPUT_PATTERN = re.compile(r'utility_|filter_|transcode_|measurement_')
_PSEUDO_FRAME_PATTERN = re.compile(r'^frame://(\d+)$')


def pseudo_frame_number(entry: str) -> Optional[int]:
    """frame://N pseudo-name to frame number, or None for a real image name."""
    match = _PSEUDO_FRAME_PATTERN.match(entry)
    return int(match.group(1)) if match else None


def video_subset_cameras(
    camera_media: Dict[str, Tuple[List[str], str]],
    image_pairs: Optional[Dict[str, List[str]]],
) -> List[str]:
    """
    Names of the cameras a frame-subset run feeds from video, i.e. the ones
    whose subset is extracted to stills by build_multicam_kwiver_settings.

    Two callers outside the settings builder need this same answer: the run
    must not also hand the pipe a video reader type once every input is an
    image list, and registration ingest must map the extracted still names
    back to the frame://N identities the client sent.
    """
    return [
        name
        for name in (image_pairs or {})
        if (camera_media.get(name) or (None, None))[1] == constants.VideoType
    ]


def extract_video_frames(
    video_path: str,
    frames: List[int],
    fps: float,
    out_dir: Path,
    camera: str,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> List[str]:
    """
    Extract specific frames of a video to still images so a frame-subset job
    can consume one uniform image-list input (no vidl_ffmpeg in the pipe, no
    video-decode variability in the matcher's input). The frame number is kept
    in the file name (<camera>.frame_<N>.png) so job outputs can be mapped
    back to frame://N identities on ingest.

    The name pattern is a contract shared with the desktop backend's
    extractVideoFrames: both ingest paths parse it to recover the frame.
    """
    if not fps or fps <= 0:
        raise ValueError(
            f'Camera "{camera}" needs a frame rate to turn registration frame numbers '
            f'into video timestamps, but the dataset reports fps={fps}'
        )
    out_dir.mkdir(parents=True, exist_ok=True)
    results: List[str] = []
    for frame_number in frames:
        # The viewer seeks video by frame/fps seconds, so a frame number means
        # that instant; ffmpeg lands on the frame covering it.
        seconds = frame_number / fps
        dest = out_dir / f'{camera}.frame_{frame_number}.png'
        completed = subprocess.run(
            [
                'ffmpeg',
                '-ss',
                f'{seconds:.6f}',
                '-i',
                video_path,
                '-frames:v',
                '1',
                # Without -update, ffmpeg's image2 muxer reads any digit-bearing
                # output name as an ambiguous sequence pattern and refuses to
                # write it; -update 1 says this is one literal file.
                '-update',
                '1',
                '-y',
                str(dest),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        # stderr is ffmpeg's own banner/progress logging even on success; the
        # exit code and the output file are the actual success signal.
        if completed.returncode != 0 or not dest.exists():
            detail = (completed.stderr or '').strip().splitlines()
            raise ValueError(
                f'Could not extract frame {frame_number} from {video_path}: '
                f'{detail[-1] if detail else "no output"}'
            )
        results.append(str(dest))
        if on_progress is not None:
            on_progress(len(results), len(frames))
    return results


def pipeline_requires_input(pipeline: PipelineDescription) -> bool:
    """True when the pipe needs existing detections/tracks as input (matches desktop)."""
    # Disparity image pipe is measurement_* but only needs stereo media + calibration.
    if is_disparity_image_pipeline(pipeline):
        return False
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


# Calibration consumers every stereo pipe is assumed to have unless it declares
# its own via a `# Calibration Keys:` header.
DEFAULT_CALIBRATION_KEYS = ('measurer:calibration_file', 'calibration_reader:file')


def stereo_calibration_keys(pipeline: Optional[PipelineDescription]) -> Tuple[str, ...]:
    """
    KWIVER keys the dataset's calibration file binds to for this pipe.

    A pipe opts out of the `measurer`/`calibration_reader` convention with a
    `# Calibration Keys: <k> [k...]` header, naming the consuming process keys
    directly (e.g. `depth_map:computer:ocv_stereo_disparity:calibration_file`).
    """
    declared = ((pipeline or {}).get('metadata') or {}).get('calibrationKeys')
    return tuple(declared) if declared else DEFAULT_CALIBRATION_KEYS


def append_stereo_calibration_kwiver_settings(
    command: List[str],
    calibration_path: Path,
    pipeline: Optional[PipelineDescription] = None,
) -> None:
    """Append KWIVER settings used by desktop for stereoscopic calibration input."""
    cal_path = shlex.quote(str(calibration_path))
    for key in stereo_calibration_keys(pipeline):
        command.append(f'-s {shlex.quote(key)}={cal_path}')


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


# Sensor-role aliases for camera names; mirrors CAMERA_ROLE_ALIASES in
# client/dive-common/pipelineCameraOrder.ts.
CAMERA_ROLE_ALIASES: Dict[str, Tuple[str, ...]] = {
    'eo': ('eo', 'rgb', 'optical', 'color', 'colour', 'vis', 'visible'),
    'ir': ('ir', 'thermal', 'lwir', 'mwir', 'flir'),
    'uv': ('uv', 'ultraviolet'),
}


def _segments(name: str) -> List[str]:
    return [seg for seg in re.split(r'[^a-z0-9]+', name.lower()) if seg]


def _role_of_token(token: str) -> Optional[str]:
    lower = token.lower()
    for role, aliases in CAMERA_ROLE_ALIASES.items():
        if lower in aliases:
            return role
    return None


def infer_camera_role(
    camera_name: str,
    image_names: Optional[List[str]] = None,
) -> Optional[str]:
    """
    The sensor role (eo / ir / uv) a camera name denotes, or None when it names
    none or more than one. Falls back to tokens in image file names (KAMERA style
    ``..._rgb.jpg`` / ``_ir.tif`` / ``_uv.jpg``). Only a unanimous answer counts.
    Set once at multicam import; the pipeline camera-assignment step shows display
    order by default and lets the user correct it.
    """
    image_names = image_names or []
    from_name = {_role_of_token(seg) for seg in _segments(camera_name)}
    from_name.discard(None)
    if len(from_name) == 1:
        return next(iter(from_name))
    if len(from_name) > 1:
        return None
    from_images: set = set()
    for image in image_names[:50]:
        base = image.replace('\\', '/').rsplit('/', 1)[-1]
        stem = re.sub(r'\.[^.]+$', '', base)
        for seg in _segments(stem):
            role = _role_of_token(seg)
            if role:
                from_images.add(role)
    return next(iter(from_images)) if len(from_images) == 1 else None


def infer_camera_roles(cameras: Dict[str, Optional[List[str]]]) -> Dict[str, str]:
    """Roles for a whole rig; cameras that cannot be classified are omitted."""
    return {
        name: role
        for name, image_names in cameras.items()
        for role in [infer_camera_role(name, image_names or [])]
        if role
    }


def build_registration_pairs(folder_meta: dict) -> List[dict]:
    """
    Convert a dataset folder's camera registration meta (cameraHomographies /
    cameraCorrespondences / cameraTransformTypes, keyed by directional
    "left::right") into dive-camera-registration file pairs (format v2).

    Meta stores each pair's points as observations -- one entry per image
    pair, carrying its own points -- so this is the inverse of
    registration_output._from_registration_pairs: the store's imageA/imageB
    become the file's imageLeft/imageRight, and each point's a/b pair becomes
    one `leftX leftY rightX rightY` row.

    VIAME's dive transform reader only consumes the matrices; the
    observations travel for provenance and so a file round-trips back into
    DIVE without losing which frame contributed what.
    """
    homographies = folder_meta.get('cameraHomographies') or {}
    correspondences = folder_meta.get('cameraCorrespondences') or {}
    transform_types = folder_meta.get('cameraTransformTypes') or {}
    keys = set(homographies) | set(correspondences) | set(transform_types)
    pairs: List[dict] = []
    for key in sorted(keys):
        left, _, right = key.partition('::')
        homography = homographies.get(key)
        observations = []
        for obs in correspondences.get(key) or []:
            observations.append(
                {
                    'imageLeft': obs.get('imageA'),
                    'imageRight': obs.get('imageB'),
                    'frame': obs.get('frame'),
                    'enabled': obs.get('enabled', True),
                    'source': obs.get('source') or 'manual',
                    **({'stats': obs['stats']} if obs.get('stats') is not None else {}),
                    'points': [
                        [p['a'][0], p['a'][1], p['b'][0], p['b'][1]]
                        for p in obs.get('points') or []
                    ],
                }
            )
        pairs.append(
            {
                'left': left,
                'right': right,
                'observations': observations,
                'leftToRight': homography.get('AtoB') if homography else None,
                'rightToLeft': homography.get('BtoA') if homography else None,
                'transformType': transform_types.get(key, 'similarity'),
            }
        )
    return pairs


def missing_registrations(
    order: List[str], registration_warps: Optional[List[int]], fitted_pairs: List[str]
) -> List[Tuple[int, str, str]]:
    """
    (input, camera, camera1) for each warped input whose camera has no fitted
    registration onto camera 1. `fitted_pairs` are the dataset's homography
    keys (`a::b`, either orientation counts). Checked before a run so the
    failure is "register camera X onto Y first" rather than the pipe dying at
    configure time on a missing file.
    """
    if not order or not registration_warps:
        return []
    target = order[0]
    fitted = set(fitted_pairs)
    missing = []
    for position in registration_warps:
        if position < 2 or position > len(order):
            continue
        camera = order[position - 1]
        if camera == target:
            continue
        if f'{camera}::{target}' not in fitted and f'{target}::{camera}' not in fitted:
            missing.append((position, camera, target))
    return missing


def describe_missing_registration(
    position: int, camera: str, target: str, pipeline_name: str
) -> str:
    return (
        f'Camera "{camera}" (input{position}) has no registration onto camera 1 ("{target}"). '
        f'Register {camera} -> {target} in the Camera Registration tab '
        f'before running {pipeline_name}.'
    )


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
                {'type': 'dive-camera-registration', 'version': 2, 'pairs': camera_pairs},
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
    image_pairs: Optional[Dict[str, List[str]]] = None,
    fps: Optional[float] = None,
    on_progress: Optional[Callable[[str], None]] = None,
) -> Tuple[Dict[str, str], Dict[str, str]]:
    """
    Build KWIVER -s key/value pairs for per-camera inputs/outputs.

    image_pairs is the registration frame subset (camera name -> ordered
    image names): when present for a camera, ONLY those images are written
    to its input list, in the given order -- row i of one camera's list
    pairs with row i of every other's. A video camera's subset arrives as
    frame://N pseudo-names and is extracted to stills at `fps`, so both media
    types reach the pipe through the identical image-list input; the caller
    must then drop any video reader type it would otherwise set (see
    video_subset_cameras).

    Returns (arg_file_pair, out_files) where out_files maps camera name -> output csv basename.
    """
    arg_file_pair: Dict[str, str] = {}
    out_files: Dict[str, str] = {}

    for i, camera in enumerate(cameras):
        key = camera['name']
        media_list, media_type = camera_media[key]
        subset = (image_pairs or {}).get(key)
        # Set once a video camera's subset has been extracted: from here on it
        # is fed as an image list, not as a video.
        extracted_subset = False
        if subset is not None:
            if media_type == constants.ImageSequenceType:
                by_name = {Path(path).name: path for path in media_list}
                missing = [name for name in subset if name not in by_name]
                if missing:
                    raise ValueError(
                        f'Camera "{key}" media does not include requested frames: {missing[:5]}'
                    )
                media_list = [by_name[name] for name in subset]
            elif media_type == constants.VideoType:
                frames: List[int] = []
                for entry in subset:
                    frame_number = pseudo_frame_number(entry)
                    if frame_number is None:
                        raise ValueError(
                            f'Expected frame://N identifiers for video camera "{key}", '
                            f'got "{entry}"'
                        )
                    frames.append(frame_number)
                assert len(media_list) == 1, 'Expected exactly one video per camera'

                def camera_progress(done: int, total: int, name: str = key) -> None:
                    # Named per camera: a rig-wide run spends most of its time
                    # here, and "which camera" is the useful half of progress.
                    if on_progress is not None:
                        on_progress(f'Extracting frames from {name}: {done}/{total}')

                media_list = extract_video_frames(
                    media_list[0],
                    frames,
                    fps or 0,
                    work_dir / f'extracted_{key}',
                    key,
                    camera_progress if on_progress is not None else None,
                )
                extracted_subset = True
            else:
                raise ValueError(
                    f'Image-pair subsets are not supported for "{media_type}" media '
                    f'(camera "{key}")'
                )
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

        if media_type == constants.ImageSequenceType or extracted_subset:
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
