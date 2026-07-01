import json
from unittest.mock import MagicMock, patch

import pytest

from dive_server import crud_dataset
from dive_server.crud_rpc import process_items, resolve_imported_dataset_info
from dive_utils import constants


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_clears_time_filters_when_null(_verify, folder_cls):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'timeFilters': [0, 100],
        },
    }
    folder_cls.return_value.save = MagicMock(side_effect=lambda f: f)

    crud_dataset.update_metadata(folder, {'timeFilters': None})

    assert 'timeFilters' not in folder['meta']
    folder_cls.return_value.save.assert_called_once()


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_sets_time_filters(_verify, folder_cls):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
        },
    }
    folder_cls.return_value.save = MagicMock(side_effect=lambda f: f)

    crud_dataset.update_metadata(folder, {'timeFilters': [10, 50]})

    assert folder['meta']['timeFilters'] == [10, 50]


# --- datasetInfo re-import resolution ---
# process_items reconciles an imported datasetInfo with the dataset's existing block via this
# helper. The subtle, regression-prone bit is the merge direction on an additive import.


def test_resolve_imported_dataset_info_additive_imported_wins_and_preserves_existing():
    """Additive: imported values win on collision; keys absent from the file survive."""
    existing = {'cruise': '2403', 'year': '2024', 'sta_lat': '26.8195'}
    meta = {'datasetInfo': {'year': '2025', 'gfishsite_id': '2024TXN012'}}

    resolved = resolve_imported_dataset_info(existing, meta, additive=True)

    assert resolved['datasetInfo'] == {
        'cruise': '2403',  # preserved: the imported file did not carry it
        'sta_lat': '26.8195',  # preserved
        'year': '2025',  # imported wins on collision
        'gfishsite_id': '2024TXN012',  # added by the import
    }


def test_resolve_imported_dataset_info_overwrite_replaces_block():
    """Overwrite (additive=False) drops the existing block entirely."""
    existing = {'cruise': '2403', 'year': '2024'}
    meta = {'datasetInfo': {'year': '2025'}}

    resolved = resolve_imported_dataset_info(existing, meta, additive=False)

    assert resolved['datasetInfo'] == {'year': '2025'}


def test_resolve_imported_dataset_info_absent_leaves_meta_untouched():
    """A file carrying no datasetInfo never touches the existing block, in either mode."""
    existing = {'cruise': '2403'}
    meta = {'type': 'image-sequence'}

    assert resolve_imported_dataset_info(existing, meta, additive=True) == meta
    assert resolve_imported_dataset_info(existing, meta, additive=False) == meta


def test_resolve_imported_dataset_info_does_not_mutate_inputs():
    existing = {'cruise': '2403'}
    meta = {'datasetInfo': {'year': '2025'}}

    resolve_imported_dataset_info(existing, meta, additive=True)

    assert existing == {'cruise': '2403'}
    assert meta == {'datasetInfo': {'year': '2025'}}


@pytest.mark.parametrize(
    ('additive', 'expected'),
    [
        (False, {'year': '2025', 'gfishsite_id': '2024TXN012'}),
        (
            True,
            {
                'cruise': '2403',
                'sta_lat': '26.8195',
                'year': '2025',
                'gfishsite_id': '2024TXN012',
            },
        ),
    ],
)
@patch('dive_server.crud_rpc.crud_dataset.update_metadata')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_process_items_resolves_dataset_info_from_dive_configuration_import(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    update_metadata,
    additive,
    expected,
):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'datasetInfo': {'cruise': '2403', 'sta_lat': '26.8195', 'year': '2024'},
        },
    }
    item = {'_id': 'item-id', 'name': 'metadata.config.json', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'metadata.config.json', 'exts': ['json']}
    payload = {
        'datasetInfo': {
            'year': '2025',
            'gfishsite_id': '2024TXN012',
        }
    }

    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.return_value = iter([file])
    file_cls.return_value.download.return_value = lambda: [json.dumps(payload).encode()]
    get_auxiliary_folder.return_value = {'_id': 'auxiliary-id'}

    warnings = process_items(folder, {'_id': 'user-id'}, additive=additive)

    assert warnings == []
    item_cls.return_value.move.assert_called_once_with(item, {'_id': 'auxiliary-id'})
    update_metadata.assert_called_once()
    update_folder, update_payload, verify = update_metadata.call_args.args
    assert update_folder == folder
    assert update_payload['datasetInfo'] == expected
    assert update_payload['version'] == 1
    assert verify is False


@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.saveImportAttributes')
@patch('dive_server.crud_rpc.crud_dataset.update_metadata')
@patch('dive_server.crud_rpc.crud.valid_images')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
@pytest.mark.parametrize(
    ('name', 'exts', 'payload'),
    [
        (
            'navigation.csv',
            ['csv'],
            '\n'.join(
                [
                    'filename,depth,temperature',
                    'image_0001.jpg,192.80,4.0',
                    'image_0002.jpg,193.10,4.1',
                    '',
                ]
            ),
        ),
        (
            'frame_metadata.json',
            ['json'],
            json.dumps({'cameras': {'singleCam': {'0': {'depth': '192.80'}}}}),
        ),
    ],
)
def test_process_items_leaves_frame_metadata_import_sources_in_dataset_folder(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    valid_images,
    update_metadata,
    save_import_attributes,
    save_annotations,
    name,
    exts,
    payload,
):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': constants.ImageSequenceType,
            'fps': 5,
        },
    }
    item = {'_id': 'item-id', 'name': name, 'meta': {}}
    file = {'_id': 'file-id', 'name': name, 'exts': exts}

    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.return_value = iter([file])
    file_cls.return_value.download.return_value = lambda: [payload.encode()]
    valid_images.return_value = [
        {'name': 'image_0001.jpg'},
        {'name': 'image_0002.jpg'},
    ]

    warnings = process_items(folder, {'_id': 'user-id'})

    assert warnings == []
    assert constants.ProcessedMarker not in item['meta']
    item_cls.return_value.move.assert_not_called()
    item_cls.return_value.remove.assert_not_called()
    get_auxiliary_folder.assert_not_called()
    save_annotations.assert_not_called()
    save_import_attributes.assert_not_called()
    update_metadata.assert_not_called()
