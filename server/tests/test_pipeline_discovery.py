from pathlib import Path

from dive_tasks.pipeline_discovery import (
    extract_pipe_metadata,
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


def test_load_static_pipelines_excludes_seagis(tmp_path: Path):
    (tmp_path / 'detector_seagis_motion.pipe').write_text('')
    (tmp_path / 'detector_gmm_motion.pipe').write_text('')

    pipedict = load_static_pipelines(tmp_path)
    assert 'detector' in pipedict
    assert len(pipedict['detector']['pipes']) == 1
    assert 'seagis' not in pipedict['detector']['pipes'][0]['pipe'].lower()


def test_load_static_pipelines_excludes_common_stereo(tmp_path: Path):
    (tmp_path / 'common_stereo_fish_tracker.pipe').write_text('')
    (tmp_path / 'common_stereo_input.pipe').write_text('')

    pipedict = load_static_pipelines(tmp_path)
    assert 'stereo' not in pipedict
    assert 'common' not in pipedict


def test_extract_pipe_metadata_requires_calibration(tmp_path: Path):
    pipe = tmp_path / 'measurement_foo.pipe'
    pipe.write_text(
        '\n'.join(
            [
                '# Description: stereo measurement',
                '# Requires Calibration: True',
                '# Input: TRACK',
                '# Output: TRACK',
            ]
        )
    )

    metadata = extract_pipe_metadata(pipe)

    assert metadata['requiresCalibration'] is True
    assert metadata['description'] == 'stereo measurement'
    assert metadata['inputType'] == 'TRACK'
    assert metadata['outputType'] == 'TRACK'
    assert metadata.get('calibrationKeys') is None


def test_extract_pipe_metadata_calibration_keys(tmp_path: Path):
    pipe = tmp_path / 'measurement_disparity.pipe'
    pipe.write_text(
        '\n'.join(
            [
                '# Description: rectified disparity',
                '# Requires Calibration: True',
                '# Calibration Keys: depth_map:computer:ocv_stereo_disparity:calibration_file'
                ' stereo_pairing:cameras_directory',
            ]
        )
    )

    metadata = extract_pipe_metadata(pipe)

    assert metadata['calibrationKeys'] == [
        'depth_map:computer:ocv_stereo_disparity:calibration_file',
        'stereo_pairing:cameras_directory',
    ]
    # The header must not bleed into the multi-line description.
    assert metadata['description'] == 'rectified disparity'


def test_extract_pipe_metadata_camera_order(tmp_path: Path):
    pipe = tmp_path / 'detector_seal_3-cam.pipe'
    pipe.write_text(
        '\n'.join(
            [
                '# Description: three camera detector',
                '# Camera Order: EO, UV, IR',
                '# Input: IMAGE (per camera)',
            ]
        )
    )

    metadata = extract_pipe_metadata(pipe)

    assert metadata['cameraOrder'] == ['EO', 'UV', 'IR']
    # The header must not bleed into the multi-line description.
    assert metadata['description'] == 'three camera detector'
    assert 'cameraOrder' not in extract_pipe_metadata(
        _write(tmp_path, 'detector_plain.pipe', ['# Description: none'])
    )


def _write(tmp_path: Path, name: str, lines: list) -> Path:
    pipe = tmp_path / name
    pipe.write_text('\n'.join(lines))
    return pipe


def test_extract_pipe_metadata_parses_metadata_file_key(tmp_path: Path):
    pipe = tmp_path / 'detector_stabilize.pipe'
    pipe.write_text(
        '\n'.join(
            [
                '# Description: stabilized detector',
                '# Metadata File: stabilizer:flight_log',
                '# Input: TRACK',
            ]
        )
    )

    metadata = extract_pipe_metadata(pipe)

    # The opt-in header binds the dataset's selected metadata attachment to this KWIVER key.
    assert metadata['metadataFileKey'] == 'stabilizer:flight_log'
    assert metadata['description'] == 'stabilized detector'
    assert metadata['inputType'] == 'TRACK'


def test_extract_pipe_metadata_absent_metadata_file_key(tmp_path: Path):
    pipe = tmp_path / 'detector_plain.pipe'
    pipe.write_text('# Description: plain detector\n# Input: TRACK\n')

    # A pipe that does not opt in leaves the key unset, so no file is injected.
    assert 'metadataFileKey' not in extract_pipe_metadata(pipe)
