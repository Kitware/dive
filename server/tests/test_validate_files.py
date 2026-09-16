from dive_server.crud_dataset import UNSUPPORTED_SIDE_FILE_REASON, validate_files
from dive_utils import constants


def test_response_shape():
    # `roles` is the single owner of what each file is for, ignored included, and the client
    # uploads the selection minus that role.
    result = validate_files(['image_0001.jpg', 'tracks.csv'])

    assert set(result) == {"ok", "message", "type", "roles", "reasons"}
    assert set(result["roles"]) == {
        "media",
        "annotations",
        "datasetConfig",
        "frameMetadata",
        "ignored",
    }


def test_image_sequence_with_annotation_csv_and_frame_metadata_csv():
    result = validate_files(['image_0001.jpg', 'tracks.csv', 'frame_metadata.csv'])

    assert result['ok'] is True
    assert result['type'] == constants.ImageSequenceType
    assert 'tracks.csv' in result['roles']['annotations']
    assert 'frame_metadata.csv' in result['roles']['frameMetadata']
    # The annotation CSV is not misclassified as a sidecar, and the sidecar is not an annotation.
    assert 'frame_metadata.csv' not in result['roles']['annotations']
    assert 'tracks.csv' not in result['roles']['frameMetadata']
    assert result['roles']['ignored'] == []


def test_image_sequence_rejects_multiple_reserved_metadata_attachments():
    result = validate_files(
        [
            'image_0001.jpg',
            'frame_metadata.csv',
            'frame_metadata.txt',
            'frame-metadata.csv',
            'frame-metadata.txt',
        ]
    )

    assert result['ok'] is False
    assert result['message'] == (
        'More than one metadata file was selected. Choose one file and try again.'
    )


def test_image_sequence_classifies_reserved_json_only_as_metadata():
    result = validate_files(['image_0001.jpg', 'frame_metadata.json'])

    assert result['ok'] is True
    assert result['roles']['frameMetadata'] == ['frame_metadata.json']
    assert result['roles']['annotations'] == []


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


def test_video_with_frame_metadata_csv_accepts_sidecar():
    result = validate_files(['movie.mp4', 'frame_metadata.csv'])

    assert result['ok'] is True
    assert result['type'] == constants.VideoType
    assert result['roles']['frameMetadata'] == ['frame_metadata.csv']
    assert 'frame_metadata.csv' not in result['roles']['ignored']


def test_large_image_with_frame_metadata_csv_accepts_sidecar():
    # The attachment is stored for every dataset type; read time decides what to do with it.
    result = validate_files(['mosaic.tif', 'frame_metadata.csv'])

    assert result['ok'] is True
    assert result['type'] == constants.LargeImageType
    assert result['roles']['frameMetadata'] == ['frame_metadata.csv']
    assert result['roles']['ignored'] == []


def test_every_role_is_populated_for_a_full_selection():
    result = validate_files(['image_0001.jpg', 'tracks.csv', 'meta.json', 'frame_metadata.csv'])

    assert result['roles'] == {
        'media': ['image_0001.jpg'],
        'annotations': ['tracks.csv'],
        'datasetConfig': ['meta.json'],
        'frameMetadata': ['frame_metadata.csv'],
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


def test_ignored_is_the_exact_complement_of_the_accepted_roles():
    # The web client uploads the selection minus `ignored`, so a file that is neither given a
    # role nor listed as ignored would silently not upload. Pin the partition over a selection
    # that reaches every branch: media, annotations, dataset config, sidecar, and two side files.
    files = [
        'image_0001.jpg',
        'image_0002.jpg',
        'tracks.csv',
        'config.json',
        'frame_metadata.csv',
        'notes.md',
        'thumbnail.png.bak',
    ]

    result = validate_files(files)

    classified = [name for role in result['roles'].values() for name in role]
    assert sorted(classified) == sorted(files)
    assert set(result['reasons']) == set(result['roles']['ignored'])


def test_species_list_json_is_dataset_config_not_annotations():
    result = validate_files(['image_0001.jpg', 'rockfish.species.json'])

    assert result['ok'] is True
    assert 'rockfish.species.json' in result['roles']['datasetConfig']
    assert 'rockfish.species.json' not in result['roles']['annotations']
    assert 'rockfish.species.json' not in result['roles']['ignored']


def test_species_list_uploads_alongside_annotations_and_a_configuration():
    # A species list has its own slot, so it competes with neither the dataset's own
    # configuration nor its annotations for a place in the upload.
    result = validate_files(['image_0001.jpg', 'tracks.json', 'config.json', 'species.json'])

    assert result['ok'] is True
    assert set(result['roles']['datasetConfig']) == {'config.json', 'species.json'}
    assert result['roles']['annotations'] == ['tracks.json']


def test_two_species_lists_are_rejected():
    result = validate_files(['image_0001.jpg', 'a.species.json', 'b.species.json'])

    assert result['ok'] is False
    assert result['message'] == "Can only upload a single species list JSON per import"


def test_two_configuration_jsons_are_still_rejected_beside_a_species_list():
    result = validate_files(['image_0001.jpg', 'config.json', 'other.meta.json', 'species.json'])

    assert result['ok'] is False
    assert result['message'] == "Can only upload a single configuration JSON per import"
