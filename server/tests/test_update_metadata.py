import json
from unittest.mock import MagicMock, patch

import pytest

from dive_server import crud, crud_dataset
from dive_server.crud_rpc import process_items, resolve_imported_dataset_info


def _stub_folder_load_and_save(folder_cls, folder):
    """Folder.load returns a deep-ish copy of meta; save returns the doc passed in."""

    def _load(*_a, **_k):
        return {
            **folder,
            'meta': dict(folder.get('meta') or {}),
        }

    folder_cls.return_value.load = MagicMock(side_effect=_load)
    folder_cls.return_value.save = MagicMock(side_effect=lambda f: f)


@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_clears_time_filters_when_null(_verify, folder_cls, crud_folder_cls):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'timeFilters': [0, 100],
        },
    }
    _stub_folder_load_and_save(folder_cls, folder)
    _stub_folder_load_and_save(crud_folder_cls, folder)

    crud_dataset.update_metadata(folder, {'timeFilters': None})

    assert 'timeFilters' not in folder['meta']
    folder_cls.return_value.save.assert_called_once()


@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_clears_calibration_source_when_null(_verify, folder_cls, crud_folder_cls):
    # A cleared / hand-refined calibration sends cameraRegistrationSource: null to
    # drop a stale producer stamp; exclude_none would otherwise leave it behind.
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'image-sequence',
            'cameraRegistrationSource': {'model': 'colmap-v3', 'swathe': '17'},
        },
    }
    _stub_folder_load_and_save(folder_cls, folder)
    _stub_folder_load_and_save(crud_folder_cls, folder)

    crud_dataset.update_metadata(folder, {'cameraRegistrationSource': None})

    assert 'cameraRegistrationSource' not in folder['meta']
    folder_cls.return_value.save.assert_called_once()


@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_sets_time_filters(_verify, folder_cls, crud_folder_cls):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
        },
    }
    _stub_folder_load_and_save(folder_cls, folder)
    _stub_folder_load_and_save(crud_folder_cls, folder)

    crud_dataset.update_metadata(folder, {'timeFilters': [10, 50]})

    assert folder['meta']['timeFilters'] == [10, 50]


@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_preserves_concurrent_convert_fields(_verify, folder_cls, crud_folder_cls):
    """Stale in-memory meta must not wipe annotate/ffprobe written by convert_video."""
    stale = {
        '_id': 'dataset-id',
        'meta': {
            'type': 'video',
            'fps': -1,
            'confidenceFilters': {'default': 0.1},
        },
    }
    db_after_convert = {
        '_id': 'dataset-id',
        'meta': {
            'type': 'video',
            'fps': 20,
            'confidenceFilters': {'default': 0.1},
            'annotate': True,
            'originalFps': 29.97,
            'ffprobe_info': {'codec_name': 'h264'},
        },
    }
    crud_folder_cls.return_value.load = MagicMock(return_value=dict(db_after_convert))
    folder_cls.return_value.save = MagicMock(side_effect=lambda f: f)

    crud_dataset.update_metadata(stale, {'datasetInfo': {'cruise': '2403'}}, verify=False)

    saved = folder_cls.return_value.save.call_args.args[0]
    assert saved['meta']['annotate'] is True
    assert saved['meta']['originalFps'] == 29.97
    assert saved['meta']['ffprobe_info']['codec_name'] == 'h264'
    assert saved['meta']['fps'] == 20
    assert saved['meta']['datasetInfo'] == {'cruise': '2403'}
    # Caller's folder dict is refreshed in place
    assert stale['meta']['annotate'] is True


def test_refresh_folder_document_replaces_stale_meta_in_place():
    folder = {'_id': 'dataset-id', 'meta': {'type': 'video'}, 'extra': 'gone'}
    fresh = {
        '_id': 'dataset-id',
        'meta': {'type': 'video', 'annotate': True},
        'name': 'bigfish',
    }
    with patch('dive_server.crud.Folder') as folder_cls:
        folder_cls.return_value.load.return_value = fresh
        crud.refresh_folder_document(folder)

    assert folder['meta']['annotate'] is True
    assert folder['name'] == 'bigfish'
    assert 'extra' not in folder


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
