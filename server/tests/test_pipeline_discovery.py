from pathlib import Path

from dive_tasks.pipeline_discovery import (
    load_static_pipelines,
    parse_pipe_type_and_name,
)


def test_parse_pipe_type_and_name_measurement():
    assert parse_pipe_type_and_name('measurement_fully_auto_gmm_motion') == (
        'measurement',
        'fully auto gmm motion',
    )


def test_parse_pipe_type_and_name_detector():
    assert parse_pipe_type_and_name('detector_gmm_motion') == (
        'detector',
        'gmm motion',
    )


def test_parse_pipe_type_and_name_multicam_suffix_hyphen():
    assert parse_pipe_type_and_name('utility_register_frames_2-cam') == (
        '2-cam',
        'utility register frames 2-cam',
    )


def test_parse_pipe_type_and_name_multicam_suffix_underscore_cam():
    assert parse_pipe_type_and_name('detector_arctic_seal_2_cam') == (
        '2-cam',
        'detector arctic seal 2 cam',
    )


def test_parse_pipe_type_and_name_one_cam_stays_detector():
    assert parse_pipe_type_and_name('detector_foo_1_cam') == (
        'detector',
        'foo 1 cam',
    )


def test_load_static_pipelines_includes_measurement_and_multicam(tmp_path: Path):
    (tmp_path / 'measurement_fully_auto_gmm_motion.pipe').write_text('# Description: test\n')
    (tmp_path / 'utility_register_frames_2-cam.pipe').write_text('')
    (tmp_path / 'utility_register_frames_3-cam.pipe').write_text('')
    (tmp_path / 'detector_gmm_motion.pipe').write_text('')

    pipedict = load_static_pipelines(tmp_path)
    assert 'measurement' in pipedict
    assert pipedict['measurement']['pipes'][0]['type'] == 'measurement'
    assert '2-cam' in pipedict
    assert '3-cam' in pipedict
    assert 'detector' in pipedict


def test_load_static_pipelines_excludes_common_stereo(tmp_path: Path):
    (tmp_path / 'common_stereo_fish_tracker.pipe').write_text('')
    (tmp_path / 'common_stereo_input.pipe').write_text('')

    pipedict = load_static_pipelines(tmp_path)
    assert 'stereo' not in pipedict
    assert 'common' not in pipedict
