from pathlib import Path

from dive_tasks.pipeline_creates_dataset import (
    append_new_dataset_media_writers,
    pipeline_renumbers_frames,
)
from dive_utils import constants


def test_append_new_dataset_media_writers_filter(tmp_path: Path):
    command: list = []
    pipeline = {'name': 'enhance', 'type': 'filter', 'pipe': 'filter_enhance.pipe'}
    result = append_new_dataset_media_writers(command, pipeline, tmp_path)
    assert result is None
    joined = ' '.join(command)
    assert 'image_writer:file_name_prefix=' in joined
    assert 'kwa_writer:output_directory=' in joined


def test_append_new_dataset_media_writers_disparity(tmp_path: Path):
    command: list = []
    pipeline = {
        'name': 'disparity',
        'type': constants.StereoPipelineMarker,
        'pipe': 'measurement_compute_rectified_disparity.pipe',
    }
    result = append_new_dataset_media_writers(command, pipeline, tmp_path)
    assert result is None
    assert any('output:file_name_template=' in part for part in command)
    assert any('depth_map%06d.png' in part for part in command)


def test_append_new_dataset_media_writers_transcode(tmp_path: Path):
    command: list = []
    pipeline = {'name': 'default', 'type': 'transcode', 'pipe': 'transcode_default.pipe'}
    video = str(tmp_path / 'out.mp4')
    result = append_new_dataset_media_writers(command, pipeline, tmp_path, video_filename=video)
    assert result == video
    assert any('video_writer:video_filename=' in part for part in command)


def test_pipeline_renumbers_frames():
    assert pipeline_renumbers_frames('filter_enhance.pipe')
    assert pipeline_renumbers_frames('transcode_default.pipe')
    assert pipeline_renumbers_frames('measurement_compute_rectified_disparity.pipe')
    assert not pipeline_renumbers_frames('detector_default.pipe')
    assert not pipeline_renumbers_frames('measurement_gmm_left_right_stereo.pipe')
