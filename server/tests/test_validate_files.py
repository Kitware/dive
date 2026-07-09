from dive_server.crud_dataset import validate_files
from dive_utils import constants

FRAME_METADATA_UNSUPPORTED_REASON = "Frame metadata is not supported for this media type"
UNSUPPORTED_SIDE_FILE_REASON = "Unsupported side file"


def _ignored_names(result):
    return [entry["name"] for entry in result["ignored"]]


def _ignored_reason(result, name):
    return next(entry["reason"] for entry in result["ignored"] if entry["name"] == name)


def test_image_sequence_with_annotation_csv_and_frame_metadata_csv():
    result = validate_files(['image_0001.jpg', 'tracks.csv', 'frame_metadata.csv'])

    assert result['ok'] is True
    assert result['type'] == constants.ImageSequenceType
    assert 'tracks.csv' in result['roles']['annotations']
    assert 'frame_metadata.csv' in result['roles']['frameMetadata']
    # The annotation CSV is not misclassified as a sidecar, and the sidecar is not an annotation.
    assert 'frame_metadata.csv' not in result['roles']['annotations']
    assert 'tracks.csv' not in result['roles']['frameMetadata']
    assert 'tracks.csv' in result['upload']
    assert 'frame_metadata.csv' in result['upload']
    assert result['ignored'] == []


def test_image_sequence_with_frame_metadata_csv_and_txt_names():
    result = validate_files(
        [
            'image_0001.jpg',
            'frame_metadata.csv',
            'frame_metadata.txt',
            'frame-metadata.csv',
            'frame-metadata.txt',
        ]
    )

    assert result['ok'] is True
    assert result['type'] == constants.ImageSequenceType
    assert result['roles']['frameMetadata'] == [
        'frame_metadata.csv',
        'frame_metadata.txt',
        'frame-metadata.csv',
        'frame-metadata.txt',
    ]
    assert 'frame_metadata.csv' in result['upload']
    assert 'frame_metadata.txt' in result['upload']
    assert 'frame-metadata.csv' in result['upload']
    assert 'frame-metadata.txt' in result['upload']
    assert result['roles']['annotations'] == []
    assert result['ignored'] == []


def test_image_sequence_with_frame_metadata_paths_for_multicamera_import():
    result = validate_files(
        [
            'left/image_0001.jpg',
            'left/frame-metadata.txt',
            'right/image_0001.jpg',
            'right/frame_metadata.csv',
        ]
    )

    assert result['ok'] is True
    assert result['type'] == constants.ImageSequenceType
    assert result['roles']['frameMetadata'] == [
        'left/frame-metadata.txt',
        'right/frame_metadata.csv',
    ]
    assert 'left/frame-metadata.txt' in result['upload']
    assert 'right/frame_metadata.csv' in result['upload']


def test_image_sequence_with_yaml_annotation():
    result = validate_files(['image_0001.jpg', 'annotations.yml'])

    assert result['ok'] is True
    assert result['type'] == constants.ImageSequenceType
    assert 'annotations.yml' in result['roles']['annotations']
    assert 'annotations.yml' in result['upload']


def test_image_sequence_with_plain_txt_is_ignored():
    result = validate_files(['image_0001.jpg', 'notes.txt'])

    assert result['ok'] is True
    assert result['type'] == constants.ImageSequenceType
    assert 'notes.txt' in _ignored_names(result)
    assert _ignored_reason(result, 'notes.txt') == UNSUPPORTED_SIDE_FILE_REASON
    assert 'notes.txt' not in result['upload']
    # The rest of the package is unaffected.
    assert result['roles']['media'] == ['image_0001.jpg']


def test_image_sequence_with_unsupported_extension_is_ignored():
    result = validate_files(['image_0001.jpg', 'weird.xyz'])

    assert result['ok'] is True
    assert 'weird.xyz' in _ignored_names(result)
    assert _ignored_reason(result, 'weird.xyz') == UNSUPPORTED_SIDE_FILE_REASON
    assert 'weird.xyz' not in result['upload']


def test_two_plain_annotation_csvs_are_rejected():
    result = validate_files(['image_0001.jpg', 'a.csv', 'b.csv'])

    assert result['ok'] is False
    assert result['message'] == "Can only upload a single CSV Annotation per import"


def test_image_sequence_with_config_json_is_dataset_config():
    result = validate_files(['image_0001.jpg', 'meta.json'])

    assert result['ok'] is True
    assert 'meta.json' in result['roles']['datasetConfig']
    assert 'meta.json' not in result['roles']['annotations']
    assert 'meta.json' in result['upload']


def test_annotation_json_and_config_json_are_distinguished():
    result = validate_files(['image_0001.jpg', 'tracks.json', 'config.json'])

    assert result['ok'] is True
    assert 'config.json' in result['roles']['datasetConfig']
    assert 'tracks.json' in result['roles']['annotations']
    assert 'config.json' not in result['roles']['annotations']


def test_video_with_frame_metadata_csv_ignores_sidecar():
    result = validate_files(['movie.mp4', 'frame_metadata.csv'])

    assert result['ok'] is True
    assert result['type'] == constants.VideoType
    assert result['roles']['frameMetadata'] == []
    assert 'frame_metadata.csv' in _ignored_names(result)
    assert _ignored_reason(result, 'frame_metadata.csv') == FRAME_METADATA_UNSUPPORTED_REASON
    assert 'frame_metadata.csv' not in result['upload']


def test_large_image_with_frame_metadata_csv_ignores_sidecar():
    result = validate_files(['mosaic.tif', 'frame_metadata.csv'])

    assert result['ok'] is True
    assert result['type'] == constants.LargeImageType
    assert result['roles']['frameMetadata'] == []
    assert 'frame_metadata.csv' in _ignored_names(result)
    assert _ignored_reason(result, 'frame_metadata.csv') == FRAME_METADATA_UNSUPPORTED_REASON
    assert 'frame_metadata.csv' not in result['upload']


def test_upload_order_is_media_then_annotations_then_config_then_frame_metadata():
    result = validate_files(['image_0001.jpg', 'tracks.csv', 'meta.json', 'frame_metadata.csv'])

    assert result['ok'] is True
    assert result['upload'] == ['image_0001.jpg', 'tracks.csv', 'meta.json', 'frame_metadata.csv']


def test_images_and_videos_mixed_is_rejected():
    result = validate_files(['image_0001.jpg', 'movie.mp4'])

    assert result['ok'] is False
    assert result['type'] == ''
    assert result['message'] == "Do not upload images and videos in the same batch."


def test_csv_and_yaml_mixed_is_rejected():
    result = validate_files(['image_0001.jpg', 'tracks.csv', 'config.yml'])

    assert result['ok'] is False
    assert result['message'] == "Cannot mix annotation import types"


def test_csv_and_annotation_json_mixed_is_rejected():
    # Two annotation sources of different formats would silently overwrite at import.
    result = validate_files(['image_0001.jpg', 'tracks.csv', 'tracks.json'])

    assert result['ok'] is False
    assert result['message'] == "Cannot mix annotation import types"


def test_yaml_and_annotation_json_mixed_is_rejected():
    result = validate_files(['image_0001.jpg', 'tracks.yml', 'tracks.json'])

    assert result['ok'] is False
    assert result['message'] == "Cannot mix annotation import types"


def test_multiple_videos_with_config_json_is_rejected():
    # A single dataset-config JSON cannot apply to a multi-video (subfolder) upload.
    result = validate_files(['a.mp4', 'b.mp4', 'config.json'])

    assert result['ok'] is False
    assert (
        result['message'] == "Annotation upload is not supported when multiple videos are uploaded"
    )


def test_multiple_videos_without_annotations_is_allowed():
    result = validate_files(['a.mp4', 'b.mp4'])

    assert result['ok'] is True
    assert result['type'] == constants.VideoType
    assert result['roles']['media'] == ['a.mp4', 'b.mp4']


def test_no_media_is_rejected():
    result = validate_files(['tracks.csv'])

    assert result['ok'] is False
    assert result['message'] == "No supported media-type files found"


def test_validate_files_tiff_as_large_image():
    files = [
        'kamera_2021_test_fl01_C_20210814_003347.198347_ir.tif',
        'kamera_2021_test_fl01_C_20210814_003353.208198_ir.tif',
    ]
    result = validate_files(files)
    assert result['ok'] is True
    assert result['type'] == constants.LargeImageType
    assert result['roles']['media'] == files


def test_validate_files_jpg_as_image_sequence():
    files = ['frame.jpg', 'frame2.jpg']
    result = validate_files(files)
    assert result['ok'] is True
    assert result['type'] == constants.ImageSequenceType
    assert result['roles']['media'] == files


def test_validate_files_nitf_remains_large_image():
    files = ['scene.nitf']
    result = validate_files(files)
    assert result['ok'] is True
    assert result['type'] == constants.LargeImageType
    assert result['roles']['media'] == files
