from pathlib import Path

from dive_tasks.multicam_pipeline import (
    append_stereo_calibration_kwiver_settings,
    build_multicam_kwiver_settings,
    find_downloaded_calibration_file,
    is_stereo_measurement_pipeline,
    is_stereo_or_multicam_pipeline,
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
