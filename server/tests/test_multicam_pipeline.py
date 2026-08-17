import json
from pathlib import Path

import pytest

from dive_tasks.multicam_pipeline import (
    DEFAULT_CALIBRATION_KEYS,
    append_stereo_calibration_kwiver_settings,
    build_multicam_kwiver_settings,
    build_registration_kwiver_settings,
    build_registration_pairs,
    cameras_matching_slot,
    find_downloaded_calibration_file,
    infer_camera_role,
    infer_camera_roles,
    is_stereo_measurement_pipeline,
    is_stereo_or_multicam_pipeline,
    missing_registrations,
    pipeline_camera_order,
    pipeline_requires_input,
    resolve_pipeline_camera_order,
    stereo_calibration_keys,
)
from dive_utils import constants


def test_pipeline_requires_input():
    assert pipeline_requires_input({'name': 'u', 'type': 'x', 'pipe': 'utility_foo.pipe'})
    assert not pipeline_requires_input({'name': 'd', 'type': 'x', 'pipe': 'detector_foo.pipe'})
    # Disparity writes images; it does not consume annotation CSV.
    assert not pipeline_requires_input(
        {
            'name': 'disparity',
            'type': constants.StereoPipelineMarker,
            'pipe': 'measurement_compute_rectified_disparity.pipe',
        }
    )
    assert pipeline_requires_input(
        {
            'name': 'meas',
            'type': constants.StereoPipelineMarker,
            'pipe': 'measurement_gmm_left_right_stereo.pipe',
        }
    )


def test_is_stereo_or_multicam_pipeline():
    assert is_stereo_or_multicam_pipeline(
        {'name': 'm', 'type': constants.StereoPipelineMarker, 'pipe': 'x.pipe'}
    )
    assert is_stereo_or_multicam_pipeline({'name': '2', 'type': '2-cam', 'pipe': 'x.pipe'})
    assert not is_stereo_or_multicam_pipeline({'name': 'd', 'type': 'detector', 'pipe': 'x.pipe'})


def test_is_stereo_measurement_pipeline():
    assert is_stereo_measurement_pipeline(
        {'name': 'm', 'type': constants.StereoPipelineMarker, 'pipe': 'measurement_x.pipe'}
    )
    assert not is_stereo_measurement_pipeline({'name': '2', 'type': '2-cam', 'pipe': 'x.pipe'})


def test_find_downloaded_calibration_file(tmp_path: Path):
    (tmp_path / 'stereo-cal.json').write_text('{}', encoding='utf-8')
    assert find_downloaded_calibration_file(tmp_path) == (tmp_path / 'stereo-cal.json').resolve()

    nested_dir = tmp_path / 'nested'
    nested_dir.mkdir()
    item_dir = nested_dir / 'item'
    item_dir.mkdir()
    (item_dir / 'calibration.npz').write_bytes(b'')
    assert find_downloaded_calibration_file(nested_dir) == (item_dir / 'calibration.npz').resolve()

    assert find_downloaded_calibration_file(tmp_path / 'empty') is None


def test_append_stereo_calibration_kwiver_settings():
    command: list = []
    append_stereo_calibration_kwiver_settings(command, Path('/work/stereo-cal.json'))
    assert command == [
        '-s measurer:calibration_file=/work/stereo-cal.json',
        '-s calibration_reader:file=/work/stereo-cal.json',
    ]


def test_append_stereo_calibration_kwiver_settings_declared_keys():
    """A pipe's `# Calibration Keys:` header replaces the default keys."""
    pipeline = {
        'name': 'disparity',
        'type': constants.StereoPipelineMarker,
        'pipe': 'measurement_compute_rectified_disparity.pipe',
        'metadata': {
            'calibrationKeys': [
                'depth_map:computer:ocv_stereo_disparity:calibration_file',
                'stereo_pairing:cameras_directory',
            ]
        },
    }
    command: list = []
    append_stereo_calibration_kwiver_settings(command, Path('/work/cal.npz'), pipeline)
    assert command == [
        '-s depth_map:computer:ocv_stereo_disparity:calibration_file=/work/cal.npz',
        '-s stereo_pairing:cameras_directory=/work/cal.npz',
    ]


def test_stereo_calibration_keys_defaults():
    assert stereo_calibration_keys(None) == DEFAULT_CALIBRATION_KEYS
    assert stereo_calibration_keys({'metadata': None}) == DEFAULT_CALIBRATION_KEYS
    assert (
        stereo_calibration_keys({'metadata': {'calibrationKeys': []}}) == DEFAULT_CALIBRATION_KEYS
    )
    assert stereo_calibration_keys({'metadata': {'calibrationKeys': ['a:b']}}) == ('a:b',)


def test_build_multicam_kwiver_settings_image_sequence(tmp_path: Path):
    cameras = [
        {'name': 'left', 'folder_id': 'l', 'media_type': constants.ImageSequenceType},
        {'name': 'right', 'folder_id': 'r', 'media_type': constants.ImageSequenceType},
    ]
    camera_media = {
        'left': (['/tmp/left/000.png', '/tmp/left/001.png'], constants.ImageSequenceType),
        'right': (['/tmp/right/000.png'], constants.ImageSequenceType),
    }
    arg_pair, out_files = build_multicam_kwiver_settings(tmp_path, cameras, camera_media)
    assert out_files == {'left': 'computed_tracks_left.csv', 'right': 'computed_tracks_right.csv'}
    assert arg_pair['input:video_filename'] == str(tmp_path / 'input1_images.txt')
    assert arg_pair['input1:video_filename'] == str(tmp_path / 'input1_images.txt')
    assert arg_pair['input2:video_filename'] == str(tmp_path / 'input2_images.txt')
    assert (tmp_path / 'input1_images.txt').read_text(encoding='utf-8') == (
        '/tmp/left/000.png\n/tmp/left/001.png'
    )


def test_pipeline_camera_order():
    # Reference first, remaining display order preserved.
    assert pipeline_camera_order(['ir', 'rgb', 'uv'], 'rgb') == ['rgb', 'ir', 'uv']
    assert pipeline_camera_order(['rgb', 'uv', 'ir'], 'rgb') == ['rgb', 'uv', 'ir']
    assert pipeline_camera_order(['CENT_IR', 'CENT_EO'], 'CENT_EO') == ['CENT_EO', 'CENT_IR']
    # Unknown reference leaves the order alone.
    assert pipeline_camera_order(['a', 'b'], 'missing') == ['a', 'b']


def test_cameras_matching_slot():
    cameras = ['rgb', 'CENT_IR', 'uv_cam']
    assert cameras_matching_slot('EO', cameras) == ['rgb']
    assert cameras_matching_slot('IR', cameras) == ['CENT_IR']
    assert cameras_matching_slot('ultraviolet', cameras) == ['uv_cam']
    assert cameras_matching_slot('rgb', cameras) == ['rgb']
    # Exact name wins over role matching elsewhere; literal segments for non-role tokens.
    assert cameras_matching_slot('ir', ['ir', 'thermal']) == ['ir']
    assert cameras_matching_slot('left', ['left_cam', 'right_cam']) == ['left_cam']


def test_infer_camera_role():
    assert infer_camera_role('rgb') == 'eo'
    assert infer_camera_role('CENT_IR') == 'ir'
    assert infer_camera_role('uv_cam') == 'uv'
    assert infer_camera_role('cam1', ['flight_0001_rgb.jpg', 'flight_0002_rgb.jpg']) == 'eo'
    assert infer_camera_role('cam1', ['a_rgb.jpg', 'b_ir.tif']) is None
    assert infer_camera_role('eo_ir') is None
    assert infer_camera_role('center', ['0001.png']) is None
    assert infer_camera_roles({'rgb': [], 'center': ['x_ir.tif'], 'other': ['a.png']}) == {
        'rgb': 'eo',
        'center': 'ir',
    }


def test_resolve_pipeline_camera_order_roles_win_over_names():
    # "thermal" is named like IR but the user marked it optical.
    assert resolve_pipeline_camera_order(
        ['EO', 'IR'], ['thermal', 'other'], {'thermal': 'eo', 'other': 'ir'}
    ) == ['thermal', 'other']


def test_missing_registrations():
    order = ['rgb', 'uv', 'ir']
    fitted = ['rgb::ir']  # stored in the reverse orientation still counts
    assert missing_registrations(order, [2, 3], fitted) == [(2, 'uv', 'rgb')]
    assert missing_registrations(order, [2, 3], fitted + ['uv::rgb']) == []
    # No warps declared (or no order): nothing to check.
    assert missing_registrations(order, None, []) == []
    assert missing_registrations([], [2], []) == []
    # Out-of-range warp positions are ignored rather than crashing.
    assert missing_registrations(['rgb', 'ir'], [3], []) == []


def test_resolve_pipeline_camera_order():
    assert resolve_pipeline_camera_order(['EO', 'UV', 'IR'], ['rgb', 'ir', 'uv']) == [
        'rgb',
        'uv',
        'ir',
    ]
    assert resolve_pipeline_camera_order(['EO', 'IR'], ['CENT_IR', 'CENT_EO']) == [
        'CENT_EO',
        'CENT_IR',
    ]
    with pytest.raises(ValueError, match='expects 2 cameras but the dataset has 3'):
        resolve_pipeline_camera_order(['EO', 'IR'], ['rgb', 'ir', 'uv'])
    with pytest.raises(ValueError, match=r'"UV" \(input2\): no dataset camera matches'):
        resolve_pipeline_camera_order(['EO', 'UV', 'IR'], ['rgb', 'ir', 'cam3'])
    with pytest.raises(ValueError, match=r'"EO" \(input1\): several dataset cameras match'):
        resolve_pipeline_camera_order(['EO', 'IR'], ['rgb', 'color'])


IR_TO_RGB = [[1, 0, 5], [0, 1, -3], [0, 0, 1]]
RGB_TO_IR = [[1, 0, -5], [0, 1, 3], [0, 0, 1]]


def test_build_registration_pairs():
    folder_meta = {
        'cameraHomographies': {'ir::rgb': {'AtoB': IR_TO_RGB, 'BtoA': RGB_TO_IR}},
        'cameraCorrespondences': {
            'ir::rgb': [
                {
                    'imageA': 'ir_0001.png',
                    'imageB': 'rgb_0001.jpg',
                    'frame': 1,
                    'enabled': True,
                    'source': 'manual',
                    'points': [{'id': 1, 'a': [1, 2], 'b': [3, 4]}],
                }
            ],
            'uv::rgb': [
                {
                    'imageA': 'uv_0002.jpg',
                    'imageB': 'rgb_0002.jpg',
                    'frame': 2,
                    'enabled': True,
                    'source': 'minima_loftr',
                    'points': [{'id': 1, 'a': [5, 6], 'b': [7, 8]}],
                }
            ],
        },
        'cameraTransformTypes': {'ir::rgb': 'affine'},
    }
    pairs = build_registration_pairs(folder_meta)
    assert pairs == [
        {
            'left': 'ir',
            'right': 'rgb',
            'observations': [
                {
                    'imageLeft': 'ir_0001.png',
                    'imageRight': 'rgb_0001.jpg',
                    'frame': 1,
                    'enabled': True,
                    'source': 'manual',
                    'points': [[1, 2, 3, 4]],
                }
            ],
            'leftToRight': IR_TO_RGB,
            'rightToLeft': RGB_TO_IR,
            'transformType': 'affine',
        },
        {
            'left': 'uv',
            'right': 'rgb',
            'observations': [
                {
                    'imageLeft': 'uv_0002.jpg',
                    'imageRight': 'rgb_0002.jpg',
                    'frame': 2,
                    'enabled': True,
                    'source': 'minima_loftr',
                    'points': [[5, 6, 7, 8]],
                }
            ],
            'leftToRight': None,
            'rightToLeft': None,
            'transformType': 'similarity',
        },
    ]
    assert build_registration_pairs({}) == []


def test_build_registration_kwiver_settings(tmp_path: Path):
    cameras = [
        {'name': 'rgb', 'folder_id': '1', 'media_type': constants.ImageSequenceType},
        {'name': 'ir', 'folder_id': '2', 'media_type': constants.ImageSequenceType},
        {'name': 'uv', 'folder_id': '3', 'media_type': constants.ImageSequenceType},
    ]
    registration = {
        'reference': 'rgb',
        'pairs': [
            {
                'left': 'ir',
                'right': 'rgb',
                'observations': [],
                'leftToRight': IR_TO_RGB,
                'rightToLeft': RGB_TO_IR,
                'transformType': 'similarity',
            },
            # Points-only pair: uv has nothing fitted, so no warp3 settings.
            {
                'left': 'uv',
                'right': 'rgb',
                'observations': [
                    {
                        'imageLeft': 'uv_0001.jpg',
                        'imageRight': 'rgb_0001.jpg',
                        'frame': 1,
                        'enabled': True,
                        'source': 'manual',
                        'points': [[1, 2, 3, 4]],
                    }
                ],
                'leftToRight': None,
                'rightToLeft': None,
                'transformType': 'similarity',
            },
            # Non-star pair (two non-reference cameras): explicitly
            # unsupported, never reaches the pipeline even though fitted.
            {
                'left': 'uv',
                'right': 'ir',
                'observations': [],
                'leftToRight': IR_TO_RGB,
                'rightToLeft': RGB_TO_IR,
                'transformType': 'similarity',
            },
        ],
    }
    settings = build_registration_kwiver_settings(tmp_path, cameras, registration)
    # One file per camera pair; uv is points-only so it gets no file or settings.
    registration_path = str(tmp_path / 'ir_to_rgb_registration.json')
    assert settings == {
        'warp2:transformation_file': registration_path,
        'warp2:transform_reader:type': 'dive',
        'warp2:transform_reader:dive:from_camera': 'ir',
        'warp2:transform_reader:dive:to_camera': 'rgb',
    }
    written = json.loads((tmp_path / 'ir_to_rgb_registration.json').read_text(encoding='utf-8'))
    assert written['type'] == 'dive-camera-registration'
    # DIVE's format-v2 loader rejects any other version rather than reading
    # a matrix-only pair with its points silently dropped; VIAME's dive
    # transform reader only consumes the matrices and ignores the version.
    assert written['version'] == 2
    assert len(written['pairs']) == 1
    assert written['pairs'][0]['left'] == 'ir'
    # uv produced no file: its only fitted pair skips the reference.
    assert list(tmp_path.iterdir()) == [tmp_path / 'ir_to_rgb_registration.json']


def test_build_registration_kwiver_settings_empty(tmp_path: Path):
    cameras = [{'name': 'rgb', 'folder_id': '1', 'media_type': constants.ImageSequenceType}]
    assert (
        build_registration_kwiver_settings(tmp_path, cameras, {'reference': '', 'pairs': []}) == {}
    )
    assert list(tmp_path.iterdir()) == []


def test_build_multicam_kwiver_settings_video(tmp_path: Path):
    cameras = [
        {'name': 'left', 'folder_id': 'l', 'media_type': constants.VideoType},
        {'name': 'right', 'folder_id': 'r', 'media_type': constants.VideoType},
    ]
    camera_media = {
        'left': (['/tmp/left.mp4'], constants.VideoType),
        'right': (['/tmp/right.mp4'], constants.VideoType),
    }
    arg_pair, out_files = build_multicam_kwiver_settings(tmp_path, cameras, camera_media)
    assert arg_pair['input:video_filename'] == '/tmp/left.mp4'
    assert arg_pair['input2:video_reader:type'] == 'vidl_ffmpeg'
    assert out_files['right'] == 'computed_tracks_right.csv'
