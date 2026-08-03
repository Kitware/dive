from dive_tasks.pipeline_creates_dataset import (
    is_disparity_image_pipeline,
    is_filter_pipeline,
    is_transcode_pipeline,
    pipeline_creates_new_dataset,
)
from dive_utils import constants


def test_pipeline_creates_new_dataset_filter_transcode():
    assert pipeline_creates_new_dataset(
        {'name': 'e', 'type': 'filter', 'pipe': 'filter_enhance.pipe'}
    )
    assert pipeline_creates_new_dataset(
        {
            'name': 't',
            'type': 'transcode',
            'pipe': 'transcode_default.pipe',
        }
    )
    assert pipeline_creates_new_dataset(
        {
            'name': 'f2',
            'type': '2-cam',
            'pipe': 'filter_register_frames_2-cam.pipe',
        }
    )
    assert pipeline_creates_new_dataset(
        {
            'name': 't2',
            'type': '2-cam',
            'pipe': 'transcode_enhance_2-cam.pipe',
        }
    )


def test_pipeline_creates_new_dataset_disparity():
    assert pipeline_creates_new_dataset(
        {
            'name': 'd',
            'type': constants.StereoPipelineMarker,
            'pipe': 'measurement_compute_rectified_disparity.pipe',
        }
    )
    assert not pipeline_creates_new_dataset(
        {
            'name': 'm',
            'type': constants.StereoPipelineMarker,
            'pipe': 'measurement_gmm_left_right_stereo.pipe',
        }
    )
    assert not pipeline_creates_new_dataset(
        {
            'name': 'd',
            'type': 'detector',
            'pipe': 'detector_default.pipe',
        }
    )


def test_is_filter_transcode_disparity_helpers():
    assert is_filter_pipeline({'name': 'f', 'type': '2-cam', 'pipe': 'filter_x_2-cam.pipe'})
    assert is_transcode_pipeline({'name': 't', 'type': 'transcode', 'pipe': 'transcode_x.pipe'})
    assert is_disparity_image_pipeline(
        {
            'name': 'd',
            'type': constants.StereoPipelineMarker,
            'pipe': 'measurement_compute_rectified_disparity.pipe',
        }
    )
    assert not is_disparity_image_pipeline(
        {
            'name': 'm',
            'type': constants.StereoPipelineMarker,
            'pipe': 'measurement_other.pipe',
        }
    )
