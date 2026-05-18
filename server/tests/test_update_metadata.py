from unittest.mock import MagicMock, patch

from dive_server import crud_dataset


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
