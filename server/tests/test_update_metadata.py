from unittest.mock import MagicMock, patch

from dive_server import crud_dataset
from dive_server.crud_rpc import merge_imported_dataset_info


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


# --- datasetInfo re-import merge ---
# On an *additive* import, process_items merges an imported datasetInfo over the dataset's
# existing block via this helper (an Overwrite import replaces the block instead). The subtle,
# regression-prone bit is the merge direction.


def test_merge_imported_dataset_info_imported_wins_and_preserves_existing():
    """Imported values win on collision; keys absent from the file survive the re-import."""
    existing = {'cruise': '2403', 'year': '2024', 'sta_lat': '26.8195'}
    imported = {'year': '2025', 'gfishsite_id': '2024TXN012'}

    merged = merge_imported_dataset_info(existing, imported)

    assert merged == {
        'cruise': '2403',  # preserved: the imported file did not carry it
        'sta_lat': '26.8195',  # preserved
        'year': '2025',  # imported wins on collision
        'gfishsite_id': '2024TXN012',  # added by the import
    }


def test_merge_imported_dataset_info_does_not_mutate_inputs():
    existing = {'cruise': '2403'}
    imported = {'year': '2025'}

    merge_imported_dataset_info(existing, imported)

    assert existing == {'cruise': '2403'}
    assert imported == {'year': '2025'}
