import json
from pathlib import Path

from dive_tasks.multicam_pipeline import (
    append_stereo_calibration_kwiver_settings,
    build_multicam_kwiver_settings,
    build_registration_kwiver_settings,
    build_registration_pairs,
    find_downloaded_calibration_file,
    is_stereo_measurement_pipeline,
    is_stereo_or_multicam_pipeline,
    pipeline_camera_order,
    pipeline_requires_input,
)
from dive_utils import constants


def test_pipeline_requires_input():
    assert pipeline_requires_input({'name': 'u', 'type': 'x', 'pipe': 'utility_foo.pipe'})
    assert not pipeline_requires_input({'name': 'd', 'type': 'x', 'pipe': 'detector_foo.pipe'})


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


IR_TO_RGB = [[1, 0, 5], [0, 1, -3], [0, 0, 1]]
RGB_TO_IR = [[1, 0, -5], [0, 1, 3], [0, 0, 1]]


def test_build_registration_pairs():
    folder_meta = {
        'cameraHomographies': {'ir::rgb': {'AtoB': IR_TO_RGB, 'BtoA': RGB_TO_IR}},
        'cameraCorrespondences': {
            'ir::rgb': [{'id': 1, 'a': [1, 2], 'b': [3, 4]}],
            'uv::rgb': [{'id': 1, 'a': [5, 6], 'b': [7, 8]}],
        },
        'cameraTransformTypes': {'ir::rgb': 'affine'},
    }
    pairs = build_registration_pairs(folder_meta)
    assert pairs == [
        {
            'left': 'ir',
            'right': 'rgb',
            'points': [[1, 2, 3, 4]],
            'leftToRight': IR_TO_RGB,
            'rightToLeft': RGB_TO_IR,
            'transformType': 'affine',
        },
        {
            'left': 'uv',
            'right': 'rgb',
            'points': [[5, 6, 7, 8]],
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
                'points': [],
                'leftToRight': IR_TO_RGB,
                'rightToLeft': RGB_TO_IR,
                'transformType': 'similarity',
            },
            # Points-only pair: uv has nothing fitted, so no warp3 settings.
            {
                'left': 'uv',
                'right': 'rgb',
                'points': [[1, 2, 3, 4]],
                'leftToRight': None,
                'rightToLeft': None,
                'transformType': 'similarity',
            },
            # Non-star pair (two non-reference cameras): explicitly
            # unsupported, never reaches the pipeline even though fitted.
            {
                'left': 'uv',
                'right': 'ir',
                'points': [],
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
