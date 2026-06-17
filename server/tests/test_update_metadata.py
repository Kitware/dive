from unittest.mock import MagicMock, patch

from dive_server import crud_dataset
from dive_server.crud_rpc import resolve_imported_dataset_info


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
