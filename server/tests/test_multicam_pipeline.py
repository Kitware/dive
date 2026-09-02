import json
from pathlib import Path

import pytest

from dive_tasks import multicam_pipeline
from dive_tasks.multicam_pipeline import (
    DEFAULT_CALIBRATION_KEYS,
    append_stereo_calibration_kwiver_settings,
    build_multicam_kwiver_settings,
    build_registration_kwiver_settings,
    build_registration_pairs,
    find_downloaded_calibration_file,
    infer_camera_role,
    infer_camera_roles,
    is_stereo_measurement_pipeline,
    is_stereo_or_multicam_pipeline,
    missing_registrations,
    pipeline_requires_input,
    pseudo_frame_number,
    stereo_calibration_keys,
    video_subset_cameras,
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


def test_infer_camera_role():
    assert infer_camera_role('rgb') == 'eo'
    assert infer_camera_role('CENT_IR') == 'ir'
    assert infer_camera_role('uv_cam') == 'uv'
    assert infer_camera_role('cam1', ['flight_0001_rgb.jpg', 'flight_0002_rgb.jpg']) == 'eo'
    assert infer_camera_role('cam1', ['a_rgb.jpg', 'b_ir.tif']) is None
    assert infer_camera_role('eo_ir') is None
    assert infer_camera_role('center', ['0001.png']) is None
    assert infer_camera_roles(
        {
            'rgb': [],
            'CENT_IR': [],
            'center': ['x_ir.tif'],
            'other': ['a.png'],
        }
    ) == {'rgb': 'eo', 'CENT_IR': 'ir', 'center': 'ir'}


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


def _video_cameras():
    return [
        {'name': 'left', 'folder_id': 'l', 'media_type': constants.VideoType},
        {'name': 'right', 'folder_id': 'r', 'media_type': constants.VideoType},
    ]


def _video_media():
    return {
        'left': (['/tmp/left.mp4'], constants.VideoType),
        'right': (['/tmp/right.mp4'], constants.VideoType),
    }


def test_pseudo_frame_number():
    assert pseudo_frame_number('frame://12') == 12
    assert pseudo_frame_number('frame://0') == 0
    assert pseudo_frame_number('000.png') is None
    assert pseudo_frame_number('frame://x') is None


def test_video_subset_cameras():
    camera_media = {
        'left': ([], constants.VideoType),
        'right': ([], constants.ImageSequenceType),
    }
    assert video_subset_cameras(camera_media, None) == []
    assert video_subset_cameras(camera_media, {'right': ['000.png']}) == []
    assert video_subset_cameras(camera_media, {'left': ['frame://1']}) == ['left']


def test_build_multicam_kwiver_settings_video_subset(tmp_path: Path, monkeypatch):
    """A video camera's subset is extracted to stills and fed as an image list."""
    calls = []

    def fake_extract(video_path, frames, fps, out_dir, camera, on_progress=None):
        calls.append((video_path, frames, fps, out_dir, camera))
        paths = [str(out_dir / f'{camera}.frame_{frame}.png') for frame in frames]
        if on_progress is not None:
            for index in range(len(paths)):
                on_progress(index + 1, len(paths))
        return paths

    monkeypatch.setattr(multicam_pipeline, 'extract_video_frames', fake_extract)
    messages = []
    arg_pair, _ = build_multicam_kwiver_settings(
        tmp_path,
        _video_cameras(),
        _video_media(),
        image_pairs={'left': ['frame://0', 'frame://7'], 'right': ['frame://1', 'frame://8']},
        fps=5.0,
        on_progress=messages.append,
    )

    assert [call[1] for call in calls] == [[0, 7], [1, 8]]
    assert [call[2] for call in calls] == [5.0, 5.0]
    # Image-list input on both cameras; no video reader is bound.
    assert arg_pair['input:video_filename'] == str(tmp_path / 'input1_images.txt')
    assert arg_pair['input2:video_filename'] == str(tmp_path / 'input2_images.txt')
    assert 'input2:video_reader:type' not in arg_pair
    assert (tmp_path / 'input1_images.txt').read_text(encoding='utf-8').splitlines() == [
        str(tmp_path / 'extracted_left' / 'left.frame_0.png'),
        str(tmp_path / 'extracted_left' / 'left.frame_7.png'),
    ]
    # Progress is per camera, so a stalled rig-wide run says which one it is on.
    assert 'Extracting frames from left: 1/2' in messages
    assert 'Extracting frames from right: 2/2' in messages


def test_build_multicam_kwiver_settings_video_subset_requires_pseudo_frames(tmp_path: Path):
    with pytest.raises(ValueError, match='frame://N'):
        build_multicam_kwiver_settings(
            tmp_path,
            _video_cameras(),
            _video_media(),
            image_pairs={'left': ['000.png']},
            fps=5.0,
        )


def test_extract_video_frames_requires_fps(tmp_path: Path):
    with pytest.raises(ValueError, match='frame rate'):
        multicam_pipeline.extract_video_frames('/tmp/left.mp4', [1], 0, tmp_path, 'left')


def test_build_multicam_kwiver_settings_large_image(tmp_path: Path):
    """A rig's TIFF camera is typed large-image; it still feeds an image list."""
    cameras = [
        {'name': 'rgb', 'folder_id': 'r', 'media_type': constants.ImageSequenceType},
        {'name': 'ir', 'folder_id': 'i', 'media_type': constants.LargeImageType},
    ]
    camera_media = {
        'rgb': (['/tmp/rgb/000.jpg'], constants.ImageSequenceType),
        'ir': (['/tmp/ir/000.tif', '/tmp/ir/001.tif'], constants.LargeImageType),
    }
    arg_pair, out_files = build_multicam_kwiver_settings(tmp_path, cameras, camera_media)

    assert arg_pair['input2:video_filename'] == str(tmp_path / 'input2_images.txt')
    # No video reader: large-image media is read off the list like any other.
    assert 'input2:video_reader:type' not in arg_pair
    assert (tmp_path / 'input2_images.txt').read_text(encoding='utf-8') == (
        '/tmp/ir/000.tif\n/tmp/ir/001.tif'
    )
    assert out_files['ir'] == 'computed_tracks_ir.csv'


def test_build_multicam_kwiver_settings_large_image_subset(tmp_path: Path):
    """Registration frame subsets resolve by name on large-image cameras too."""
    cameras = [
        {'name': 'ir', 'folder_id': 'i', 'media_type': constants.LargeImageType},
    ]
    camera_media = {'ir': (['/tmp/ir/000.tif', '/tmp/ir/001.tif'], constants.LargeImageType)}

    arg_pair, _ = build_multicam_kwiver_settings(
        tmp_path, cameras, camera_media, image_pairs={'ir': ['001.tif']}
    )

    assert (tmp_path / 'input1_images.txt').read_text(encoding='utf-8') == '/tmp/ir/001.tif'
    assert arg_pair['input:video_filename'] == str(tmp_path / 'input1_images.txt')
