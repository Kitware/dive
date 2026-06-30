from unittest.mock import patch

from dive_server import crud_dataset
from dive_utils import constants


def _dataset_folder():
    return {
        '_id': 'dataset-id',
        'name': 'single-camera',
        'meta': {
            'annotate': True,
            'type': constants.ImageSequenceType,
        },
    }


def _image_item(name: str):
    return {
        '_id': f'{name}-id',
        'name': name,
    }


def _source_item(name: str):
    return {
        '_id': f'{name}-id',
        'name': name,
    }


def _wire_item_downloads(item_model, file_model, texts_by_name):
    def child_files(item):
        if item['name'] not in texts_by_name:
            raise AssertionError(f'unexpected download for {item["name"]}')
        return iter(
            [
                {
                    '_id': f'{item["_id"]}-file',
                    'itemId': item['_id'],
                    'name': item['name'],
                }
            ]
        )

    def download(file, headers=False):
        return lambda: [texts_by_name[file['name']].encode('utf-8')]

    item_model.childFiles.side_effect = child_files
    file_model.download.side_effect = download


@patch('dive_server.crud_dataset.File')
@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_load_frame_metadata_reads_co_located_source_and_applies_window(
    get_clone_root,
    valid_images,
    folder_cls,
    item_cls,
    file_cls,
):
    dataset = _dataset_folder()
    source_root = {'_id': 'source-root-id', 'name': 'source-root', 'meta': dataset['meta']}
    user = {'_id': 'user-id'}
    valid_images.return_value = [
        _image_item('image_0001.jpg'),
        _image_item('image_0002.jpg'),
        _image_item('image_0003.jpg'),
    ]
    get_clone_root.return_value = source_root
    folder_model = folder_cls.return_value
    folder_model.childItems.return_value = [
        _source_item('image_0001.jpg'),
        _source_item('frame_metadata.json'),
        _source_item('navigation.txt'),
    ]
    item_model = item_cls.return_value
    file_model = file_cls.return_value
    _wire_item_downloads(
        item_model,
        file_model,
        {
            'navigation.txt': (
                "filename,depth,temperature\n"
                "image_0001.jpg,192.80,4.0\n"
                "image_0002.jpg,193.10,4.1\n"
                "image_0003.jpg,193.40,4.2\n"
            ),
        },
    )

    result = crud_dataset.load_frame_metadata(dataset, user, startFrame=1, endFrame=2)

    assert result == {
        'cameras': {
            'singleCam': {
                '1': {
                    'filename': 'image_0002.jpg',
                    'depth': '193.10',
                    'temperature': '4.1',
                },
                '2': {
                    'filename': 'image_0003.jpg',
                    'depth': '193.40',
                    'temperature': '4.2',
                },
            },
        },
    }
    folder_model.childItems.assert_called_once_with(source_root)
    item_model.childFiles.assert_called_once_with(_source_item('navigation.txt'))
    folder_model.save.assert_not_called()
    item_model.move.assert_not_called()


@patch('dive_server.crud_dataset.File')
@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_load_frame_metadata_returns_empty_cameras_without_text_source(
    get_clone_root,
    valid_images,
    folder_cls,
    item_cls,
    file_cls,
):
    dataset = _dataset_folder()
    source_root = {'_id': 'source-root-id', 'name': 'source-root', 'meta': dataset['meta']}
    user = {'_id': 'user-id'}
    valid_images.return_value = [_image_item('image_0001.jpg')]
    get_clone_root.return_value = source_root
    folder_model = folder_cls.return_value
    folder_model.childItems.return_value = [
        _source_item('frame_metadata.json'),
        _source_item('notes.txt'),
    ]
    item_model = item_cls.return_value
    file_model = file_cls.return_value
    _wire_item_downloads(
        item_model,
        file_model,
        {
            'notes.txt': "note,value\nhello,world\n",
        },
    )

    result = crud_dataset.load_frame_metadata(dataset, user, startFrame=0, endFrame=0)

    assert result == {'cameras': {}}
    item_model.childFiles.assert_called_once_with(_source_item('notes.txt'))
    folder_model.save.assert_not_called()
    item_model.move.assert_not_called()
    file_model.save.assert_not_called()
