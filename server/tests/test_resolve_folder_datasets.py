from unittest.mock import MagicMock, patch

from girder.exceptions import RestException
import pytest

from dive_server import crud_dataset


def _folder(folder_id: str, annotate: bool = False, folder_type: str | None = None):
    meta = {'annotate': annotate}
    if folder_type is not None:
        meta['type'] = folder_type
    return {'_id': folder_id, 'name': folder_id, 'meta': meta}


@patch('dive_server.crud_dataset.Folder')
def test_resolve_walks_nested_containers_deduplicates_and_stops_at_sequences(folder_cls):
    sequence = _folder('sequence', True)
    multi = _folder('multi', True, 'multi')
    nested = _folder('nested')
    root = _folder('root')

    def _load(folder_id, **_kwargs):
        return {
            'root': root,
            'nested': nested,
            'sequence': sequence,
            'multi': multi,
        }[folder_id]

    def _child_folders(parent, **_kwargs):
        parent_id = str(parent['_id'])
        if parent_id == 'root':
            return [nested, sequence]
        if parent_id == 'nested':
            return [multi, sequence]
        return []

    folder_model = folder_cls.return_value
    folder_model.load.side_effect = lambda folder_id, **_kwargs: _load(str(folder_id))
    folder_model.childFolders.side_effect = _child_folders
    folder_model.filter.side_effect = lambda doc: doc

    result = crud_dataset.resolve_folder_datasets(
        {'_id': 'user'},
        ['root', 'nested', sequence['_id']],
    )
    assert [item['_id'] for item in result] == ['sequence', 'multi']
    assert result[1]['meta']['type'] == 'multi'
    assert [str(call.args[0]['_id']) for call in folder_model.childFolders.call_args_list] == [
        'root',
        'nested',
    ]


@patch('dive_server.crud_dataset.Folder')
def test_resolve_loads_every_page_of_a_large_folder(folder_cls):
    root = _folder('root')

    def _child_folders(parent, limit=0, offset=0, **_kwargs):
        if str(parent['_id']) != 'root':
            return []
        if offset == 0:
            return [_folder(f'sequence-{index}', True) for index in range(100)]
        if offset == 100:
            return [_folder('last-sequence', True)]
        return []

    folder_model = folder_cls.return_value
    folder_model.load.return_value = root
    folder_model.childFolders.side_effect = _child_folders
    folder_model.filter.side_effect = lambda doc: doc

    result = crud_dataset.resolve_folder_datasets({'_id': 'user'}, ['root'])
    assert len(result) == 101
    assert result[-1]['_id'] == 'last-sequence'
    offsets = [call.kwargs['offset'] for call in folder_model.childFolders.call_args_list]
    assert offsets == [0, 100]


@patch('dive_server.crud_dataset.Folder')
def test_resolve_returns_empty_for_empty_folder_selection(folder_cls):
    folder_model = folder_cls.return_value
    folder_model.load.return_value = _folder('empty')
    folder_model.childFolders.return_value = []
    folder_model.filter.side_effect = lambda doc: doc

    assert crud_dataset.resolve_folder_datasets({'_id': 'user'}, ['empty']) == []
    folder_model.childFolders.assert_called_once()


@patch('dive_server.crud_dataset.Folder')
def test_resolve_raises_when_folder_is_not_readable(folder_cls):
    folder_cls.return_value.load.return_value = None
    with pytest.raises(RestException):
        crud_dataset.resolve_folder_datasets({'_id': 'user'}, ['missing'])
