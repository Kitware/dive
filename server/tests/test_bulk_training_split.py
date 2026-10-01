from unittest.mock import MagicMock, patch

from girder.exceptions import RestException, ValidationException
import pymongo
import pytest

from dive_server import crud_dataset


def test_training_split_bulk_update_doc():
    assert crud_dataset._training_split_bulk_update('train') == {
        '$set': {'meta.trainingSplit': 'train'},
    }
    assert crud_dataset._training_split_bulk_update(None) == {
        '$unset': {'meta.trainingSplit': ''},
    }


def _folder(folder_id: str, annotate: bool = False):
    return {'_id': folder_id, 'name': folder_id, 'meta': {'annotate': annotate}}


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.resolve_folder_datasets')
def test_bulk_training_split_updates_datasets_and_root(resolve, folder_cls):
    root = _folder('root')
    datasets = [_folder('sequence-a', True), _folder('sequence-b', True)]
    resolve.return_value = datasets

    folder_model = folder_cls.return_value
    folder_model.load.side_effect = lambda folder_id, **_kwargs: {
        'root': root,
        'sequence-a': datasets[0],
        'sequence-b': datasets[1],
    }[str(folder_id)]
    folder_model.save.side_effect = lambda doc: doc
    bulk_write = MagicMock()
    folder_model.collection.bulk_write = bulk_write

    result = crud_dataset.bulk_set_training_split_under_folders(
        {'_id': 'user'},
        ['root'],
        'validation',
    )

    assert result['updatedCount'] == 2
    assert result['datasetIds'] == ['sequence-a', 'sequence-b']
    bulk_write.assert_called_once()
    operations = bulk_write.call_args.args[0]
    assert len(operations) == 2
    assert all(isinstance(op, pymongo.UpdateOne) for op in operations)
    assert root['meta']['trainingSplit'] == 'validation'
    folder_model.save.assert_called_once_with(root)


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.resolve_folder_datasets')
def test_bulk_training_split_clears_split(resolve, folder_cls):
    root = _folder('root')
    root['meta']['trainingSplit'] = 'test'
    dataset = _folder('sequence', True)
    dataset['meta']['trainingSplit'] = 'test'
    resolve.return_value = [dataset]

    folder_model = folder_cls.return_value
    folder_model.load.side_effect = lambda folder_id, **_kwargs: {
        'root': root,
        'sequence': dataset,
    }[str(folder_id)]
    folder_model.save.side_effect = lambda doc: doc
    folder_model.collection.bulk_write = MagicMock()

    crud_dataset.bulk_set_training_split_under_folders(
        {'_id': 'user'},
        ['root'],
        None,
    )

    assert folder_model.collection.bulk_write.call_args.args[0]
    assert 'trainingSplit' not in root['meta']


@patch('dive_server.crud_dataset.Folder')
def test_bulk_training_split_rejects_invalid_split(folder_cls):
    folder_cls.return_value.load.return_value = _folder('root')
    with pytest.raises((RestException, ValidationException)):
        crud_dataset.bulk_set_training_split_under_folders(
            {'_id': 'user'},
            ['root'],
            'holdout',
        )


@patch('dive_server.crud_dataset.Folder')
def test_bulk_training_split_requires_write_on_root(folder_cls):
    folder_cls.return_value.load.return_value = None
    with pytest.raises(RestException) as error:
        crud_dataset.bulk_set_training_split_under_folders(
            {'_id': 'user'},
            ['root'],
            'train',
        )
    assert error.value.code == 403
