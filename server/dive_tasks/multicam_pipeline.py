"""Helpers for running stereo and multicam VIAME pipelines on web datasets."""

from __future__ import annotations

import json
from pathlib import Path
import re
import shlex
from typing import Dict, List, Optional, Tuple

from dive_tasks.pipeline_creates_dataset import is_disparity_image_pipeline
from dive_utils import constants
from dive_utils.types import MulticamCameraJob, MulticamRegistrationJob, PipelineDescription

_PIPELINE_INPUT_PATTERN = re.compile(r'utility_|filter_|transcode_|measurement_')


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


# Role aliases: a slot token and a camera name match when they share a role, or
# when the token itself appears as a segment of the camera name (so pipes can
# name cameras literally, e.g. `# Camera Order: left, right`). Kept in sync with
# client/dive-common/pipelineCameraOrder.ts.
CAMERA_ROLE_ALIASES: Dict[str, Tuple[str, ...]] = {
    'eo': ('eo', 'rgb', 'optical', 'color', 'colour', 'vis', 'visible'),
    'ir': ('ir', 'thermal', 'lwir', 'mwir', 'flir'),
    'uv': ('uv', 'ultraviolet'),
}


def _name_segments(name: str) -> List[str]:
    return [seg for seg in re.split(r'[^a-z0-9]+', name.lower()) if seg]


def role_of_token(token: str) -> Optional[str]:
    """The role (eo / ir / uv) a slot token or camera-name segment denotes, if any."""
    lower = token.lower()
    return next((role for role, aliases in CAMERA_ROLE_ALIASES.items() if lower in aliases), None)


def infer_camera_role(camera_name: str, image_names: Optional[List[str]] = None) -> Optional[str]:
    """
    Infer a camera's sensor role from its name, falling back to tokens in its
    image file names (KAMERA style `..._rgb.jpg` / `_ir.tif` / `_uv.jpg`).
    Only a unanimous answer counts: a name or file set naming two roles yields
    None. Kept in sync with client/dive-common/pipelineCameraOrder.ts.
    """
    from_name = {r for r in (role_of_token(seg) for seg in _name_segments(camera_name)) if r}
    if len(from_name) == 1:
        return next(iter(from_name))
    if len(from_name) > 1:
        return None
    from_images = set()
    for image in (image_names or [])[:50]:
        base = re.split(r'[\\/]', image)[-1]
        stem = re.sub(r'\.[^.]+$', '', base)
        from_images.update(r for r in (role_of_token(seg) for seg in _name_segments(stem)) if r)
    return next(iter(from_images)) if len(from_images) == 1 else None


def infer_camera_roles(cameras: Dict[str, Optional[List[str]]]) -> Dict[str, str]:
    """Infer roles for a whole rig; cameras that cannot be classified are omitted."""
    roles: Dict[str, str] = {}
    for name, images in cameras.items():
        role = infer_camera_role(name, images or [])
        if role:
            roles[name] = role
    return roles


def candidates_for_slot(
    slot: str, cameras: List[str], roles: Optional[Dict[str, str]] = None
) -> List[str]:
    """
    Cameras that could fill a slot: cameras whose assigned role equals the
    slot's role take precedence over name matching, so a corrected role wins
    over a misleading name.
    """
    role = role_of_token(slot)
    if role and roles:
        by_role = [camera for camera in cameras if roles.get(camera) == role]
        if by_role:
            return by_role
    return cameras_matching_slot(slot, cameras)


def cameras_matching_slot(token: str, cameras: List[str]) -> List[str]:
    """Cameras whose name matches a slot token, by exact name, segment, or shared role."""
    lower = token.lower()
    exact = [camera for camera in cameras if camera.lower() == lower]
    if exact:
        return exact
    role = next((r for r, aliases in CAMERA_ROLE_ALIASES.items() if lower in aliases), None)
    aliases = set(CAMERA_ROLE_ALIASES[role]) if role else {lower}
    return [camera for camera in cameras if any(seg in aliases for seg in _name_segments(camera))]


def resolve_pipeline_camera_order(
    slots: List[str], cameras: List[str], roles: Optional[Dict[str, str]] = None
) -> List[str]:
    """
    Map a pipe's declared `# Camera Order:` slots onto dataset cameras without
    user interaction: every slot must match exactly one camera (by assigned
    role first, then by name) and no camera may fill two slots. Raises
    ValueError with a message naming the slot, the pipe's slots and the
    dataset's cameras otherwise, so the run fails up front instead of being
    silently mis-wired.
    """
    context = f'pipeline cameras [{", ".join(slots)}], dataset cameras [{", ".join(cameras)}]'
    if len(slots) != len(cameras):
        raise ValueError(
            f'Pipeline expects {len(slots)} cameras but the dataset has {len(cameras)}: '
            f'{context}'
        )
    order: List[str] = []
    for index, slot in enumerate(slots, start=1):
        matches = [c for c in candidates_for_slot(slot, cameras, roles) if c not in order]
        if len(matches) != 1:
            why = (
                'no dataset camera matches'
                if not matches
                else f'several dataset cameras match ({", ".join(matches)})'
            )
            raise ValueError(
                f'Cannot place pipeline camera "{slot}" (input{index}): {why}. {context}. '
                'Set the camera roles (or rename the cameras) so each pipeline camera '
                'matches exactly one.'
            )
        order.append(matches[0])
    return order


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
