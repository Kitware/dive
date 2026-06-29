"""Helpers for detecting and parsing stereo calibration file formats."""

import json

from girder.models.file import File

from dive_utils import types


def read_file_model_bytes(file_model: dict) -> bytes:
    chunks: list[bytes] = []
    with File().open(file_model) as fh:
        while True:
            chunk = fh.read(4096)
            if not chunk:
                break
            chunks.append(chunk)
    return b"".join(chunks)


def is_valid_json_bytes(data: bytes) -> bool:
    try:
        json.loads(data.decode('utf-8'))
        return True
    except (ValueError, UnicodeDecodeError):
        return False


def looks_like_zip_bytes(data: bytes) -> bool:
    """True when data starts with ZIP local-file-header magic (e.g. mislabeled .npz)."""
    return len(data) >= 2 and data[0] == 0x50 and data[1] == 0x4b


def calibration_upload_is_final_json(file_name: str, file_bytes: bytes) -> bool:
    """
    True when an uploaded file named .json is real JSON (not a binary mislabeled .json).

    Matches desktop prepareDatasetCalibration: valid JSON skips VIAME conversion.
    """
    if not file_name.lower().endswith('.json'):
        return False
    return is_valid_json_bytes(file_bytes)


def prepare_conversion_input_path(
    input_path,
    file_bytes: bytes,
    working_directory_path,
):
    """
    If a mislabeled .json is actually a ZIP/npz archive, return a .npz path for VIAME.

    Returns the path to pass to convert_cam_format.py (may be input_path unchanged).
    """
    from pathlib import Path

    path = Path(input_path)
    if not path.name.lower().endswith('.json') or not looks_like_zip_bytes(file_bytes):
        return path
    base = path.stem
    npz_path = Path(working_directory_path) / f'{base}.npz'
    if path.resolve() != npz_path.resolve():
        npz_path.write_bytes(file_bytes)
    return npz_path


def optional_calibration_number(data: dict, key: str) -> float | None:
    if key not in data or data[key] is None:
        return None
    return float(data[key])


def parse_camera_calibration(data: dict, side: str) -> types.CameraCalibration:
    calib: types.CameraCalibration = {}
    for json_key, field in (
        (f'cx_{side}', 'cx'),
        (f'cy_{side}', 'cy'),
        (f'fx_{side}', 'fx'),
        (f'fy_{side}', 'fy'),
        (f'k1_{side}', 'k1'),
        (f'k2_{side}', 'k2'),
        (f'k3_{side}', 'k3'),
        (f'p1_{side}', 'p1'),
        (f'p2_{side}', 'p2'),
    ):
        value = optional_calibration_number(data, json_key)
        if value is not None:
            calib[field] = value
    rms_error = optional_calibration_number(data, f'rms_error_{side}')
    if rms_error is not None:
        calib['rmsError'] = rms_error
    return calib


def parse_stereo_calibration_json(data: dict) -> types.DatasetStereoCalibration:
    result: types.DatasetStereoCalibration = {
        'R': data['R'],
        'T': data['T'],
        'calibrations': {
            'left': parse_camera_calibration(data, 'left'),
            'right': parse_camera_calibration(data, 'right'),
        },
    }
    optional_fields = (
        ('grid_height', 'gridHeight'),
        ('grid_width', 'gridWidth'),
        ('image_height', 'imageHeight'),
        ('image_width', 'imageWidth'),
        ('square_size_mm', 'squareSize'),
        ('rms_error_stereo', 'rmsError'),
    )
    for json_key, field in optional_fields:
        value = optional_calibration_number(data, json_key)
        if value is not None:
            result[field] = int(value) if field.startswith('grid') or field.startswith('image') else value
    return result
