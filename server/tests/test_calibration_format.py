from dive_utils import calibration_format


def test_looks_like_zip_bytes():
    assert calibration_format.looks_like_zip_bytes(b'PK\x03\x04')
    assert not calibration_format.looks_like_zip_bytes(b'{"R": []}')


def test_calibration_upload_is_final_json():
    assert calibration_format.calibration_upload_is_final_json('cal.json', b'{"R": []}')
    assert not calibration_format.calibration_upload_is_final_json('cal.npz', b'PK\x03\x04')
    assert not calibration_format.calibration_upload_is_final_json('cal.json', b'PK\x03\x04')


def test_is_valid_json_bytes():
    assert calibration_format.is_valid_json_bytes(b'{"a": 1}')
    assert not calibration_format.is_valid_json_bytes(b'not json')


def test_parse_stereo_calibration_json_int_casts_grid_and_image_sizes():
    parsed = calibration_format.parse_stereo_calibration_json(
        {
            'R': [1, 0, 0, 0, 1, 0, 0, 0, 1],
            'T': [0.1, 0.2, 0.3],
            'grid_height': 8.0,
            'grid_width': 11.0,
            'image_height': 1080.9,
            'image_width': 1920.1,
            'cx_left': 1.5,
        }
    )
    assert parsed['gridHeight'] == 8
    assert parsed['gridWidth'] == 11
    assert parsed['imageHeight'] == 1080
    assert parsed['imageWidth'] == 1920
    assert parsed['calibrations']['left']['cx'] == 1.5
