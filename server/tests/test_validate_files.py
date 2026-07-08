from dive_server import crud_dataset
from dive_utils import constants


def test_validate_files_tiff_as_large_image():
    files = [
        'kamera_2021_test_fl01_C_20210814_003347.198347_ir.tif',
        'kamera_2021_test_fl01_C_20210814_003353.208198_ir.tif',
    ]
    result = crud_dataset.validate_files(files)
    assert result['ok'] is True
    assert result['type'] == constants.LargeImageType
    assert result['media'] == files


def test_validate_files_jpg_as_image_sequence():
    files = ['frame.jpg', 'frame2.jpg']
    result = crud_dataset.validate_files(files)
    assert result['ok'] is True
    assert result['type'] == constants.ImageSequenceType
    assert result['media'] == files


def test_validate_files_nitf_remains_large_image():
    files = ['scene.nitf']
    result = crud_dataset.validate_files(files)
    assert result['ok'] is True
    assert result['type'] == constants.LargeImageType
    assert result['media'] == files
