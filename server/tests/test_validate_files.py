from dive_server.crud_dataset import UNSUPPORTED_SIDE_FILE_REASON, validate_files
from dive_utils import constants


def test_response_shape():
    # `roles` is the single owner of what each file is for, ignored included, and the client
    # uploads the selection minus that role.
    result = validate_files(['image_0001.jpg', 'tracks.csv'])

    assert set(result) == {"ok", "message", "type", "roles", "reasons"}
    assert set(result["roles"]) == {"media", "annotations", "datasetConfig", "ignored"}


def test_image_sequence_with_yaml_annotation():
    result = validate_files(['image_0001.jpg', 'annotations.yml'])

    assert result['ok'] is True
    assert result['type'] == constants.ImageSequenceType
    assert 'annotations.yml' in result['roles']['annotations']


def test_image_sequence_with_plain_txt_is_ignored():
    result = validate_files(['image_0001.jpg', 'notes.txt'])

    assert result['ok'] is True
    assert result['type'] == constants.ImageSequenceType
    assert 'notes.txt' in result['roles']['ignored']
    assert result['reasons']['notes.txt'] == UNSUPPORTED_SIDE_FILE_REASON
    # The rest of the package is unaffected.
    assert result['roles']['media'] == ['image_0001.jpg']


def test_image_sequence_with_unsupported_extension_is_ignored():
    result = validate_files(['image_0001.jpg', 'weird.xyz'])

    assert result['ok'] is True
    assert 'weird.xyz' in result['roles']['ignored']
    assert result['reasons']['weird.xyz'] == UNSUPPORTED_SIDE_FILE_REASON


def test_two_plain_annotation_csvs_are_rejected():
    result = validate_files(['image_0001.jpg', 'a.csv', 'b.csv'])

    assert result['ok'] is False
    assert result['message'] == "Can only upload a single CSV Annotation per import"


def test_image_sequence_with_config_json_is_dataset_config():
    result = validate_files(['image_0001.jpg', 'meta.json'])

    assert result['ok'] is True
    assert 'meta.json' in result['roles']['datasetConfig']
    assert 'meta.json' not in result['roles']['annotations']
    assert 'meta.json' not in result['roles']['ignored']


def test_annotation_json_and_config_json_are_distinguished():
    result = validate_files(['image_0001.jpg', 'tracks.json', 'config.json'])

    assert result['ok'] is True
    assert 'config.json' in result['roles']['datasetConfig']
    assert 'tracks.json' in result['roles']['annotations']
    assert 'config.json' not in result['roles']['annotations']


def test_every_role_is_populated_for_a_full_selection():
    result = validate_files(['image_0001.jpg', 'tracks.csv', 'meta.json'])

    assert result['ok'] is True
    assert result['roles'] == {
        'media': ['image_0001.jpg'],
        'annotations': ['tracks.csv'],
        'datasetConfig': ['meta.json'],
        'ignored': [],
    }
    assert result['reasons'] == {}


def test_images_and_videos_mixed_is_rejected():
    result = validate_files(['image_0001.jpg', 'movie.mp4'])

    assert result['ok'] is False
    # A rejected selection carries no media type.
    assert 'type' not in result
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
    assert result['message'] == "Annotation upload is not supported when multiple videos are uploaded"


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


def test_ignored_is_the_exact_complement_of_the_accepted_roles():
    # The web client uploads the selection minus `ignored`, so a file that is neither given a
    # role nor listed as ignored would silently not upload. Pin the partition over a selection
    # that reaches every branch: media, annotations, dataset config, and two side files.
    files = [
        'image_0001.jpg',
        'image_0002.jpg',
        'tracks.csv',
        'config.json',
        'notes.md',
        'thumbnail.png.bak',
    ]

    result = validate_files(files)

    classified = [name for role in result['roles'].values() for name in role]
    assert sorted(classified) == sorted(files)
    assert set(result['reasons']) == set(result['roles']['ignored'])
