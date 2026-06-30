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


def _multicam_parent_folder():
    return {
        '_id': 'parent-id',
        'name': 'stereo-camera',
        'meta': {
            'annotate': True,
            'type': constants.MultiType,
            'fps': 5,
            'multiCam': {
                'defaultDisplay': 'port',
                'cameraOrder': ['port', 'starboard'],
                'cameras': {
                    'port': {'folderId': 'port-id', 'type': constants.ImageSequenceType},
                    'starboard': {
                        'folderId': 'starboard-id',
                        'type': constants.ImageSequenceType,
                    },
                },
            },
        },
    }


def _camera_folder(folder_id: str, name: str):
    return {
        '_id': folder_id,
        'name': name,
        'meta': {
            'annotate': True,
            'type': constants.ImageSequenceType,
            'fps': 5,
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


def _root_folder(folder_id: str, name: str):
    return {
        '_id': folder_id,
        'name': name,
        'meta': {},
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


def _wire_multicam_folders(folder_model, children, items_by_folder_id):
    def load_folder(folder_id, level=None, user=None):
        return children.get(folder_id)

    def child_items(folder):
        return items_by_folder_id.get(folder['_id'], [])

    folder_model.load.side_effect = load_folder
    folder_model.childItems.side_effect = child_items


def _wire_multicam_clone_roots(get_clone_root, roots_by_folder_id):
    def clone_root(user, folder):
        return roots_by_folder_id[folder['_id']]

    get_clone_root.side_effect = clone_root


def _wire_multicam_valid_images(valid_images, images_by_folder_id):
    def images(folder, user):
        return images_by_folder_id.get(folder['_id'], [])

    valid_images.side_effect = images


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


@patch('dive_server.crud_dataset.File')
@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_load_frame_metadata_routes_root_multicam_source_by_child_camera(
    get_clone_root,
    valid_images,
    folder_cls,
    item_cls,
    file_cls,
):
    parent = _multicam_parent_folder()
    port = _camera_folder('port-id', 'port')
    starboard = _camera_folder('starboard-id', 'starboard')
    parent_root = _root_folder('parent-root-id', 'parent-root')
    port_root = _root_folder('port-root-id', 'port-root')
    starboard_root = _root_folder('starboard-root-id', 'starboard-root')
    user = {'_id': 'user-id'}

    folder_model = folder_cls.return_value
    _wire_multicam_folders(
        folder_model,
        {'port-id': port, 'starboard-id': starboard},
        {
            'parent-root-id': [_source_item('navigation.txt')],
            'port-root-id': [],
            'starboard-root-id': [],
        },
    )
    _wire_multicam_clone_roots(
        get_clone_root,
        {
            'parent-id': parent_root,
            'port-id': port_root,
            'starboard-id': starboard_root,
        },
    )
    _wire_multicam_valid_images(
        valid_images,
        {
            'port-id': [_image_item('port_0001.jpg'), _image_item('port_0002.jpg')],
            'starboard-id': [
                _image_item('starboard_0001.jpg'),
                _image_item('starboard_0002.jpg'),
            ],
        },
    )
    item_model = item_cls.return_value
    file_model = file_cls.return_value
    _wire_item_downloads(
        item_model,
        file_model,
        {
            'navigation.txt': (
                "port_image,starboard_image,depth,temperature\n"
                "port_0001.jpg,starboard_0001.jpg,192.80,4.0\n"
                "port_0002.jpg,starboard_0002.jpg,193.10,4.1\n"
            ),
        },
    )

    result = crud_dataset.load_frame_metadata(parent, user, startFrame=0, endFrame=1)

    assert result == {
        'cameras': {
            'port': {
                '0': {
                    'port_image': 'port_0001.jpg',
                    'starboard_image': 'starboard_0001.jpg',
                    'depth': '192.80',
                    'temperature': '4.0',
                },
                '1': {
                    'port_image': 'port_0002.jpg',
                    'starboard_image': 'starboard_0002.jpg',
                    'depth': '193.10',
                    'temperature': '4.1',
                },
            },
            'starboard': {
                '0': {
                    'port_image': 'port_0001.jpg',
                    'starboard_image': 'starboard_0001.jpg',
                    'depth': '192.80',
                    'temperature': '4.0',
                },
                '1': {
                    'port_image': 'port_0002.jpg',
                    'starboard_image': 'starboard_0002.jpg',
                    'depth': '193.10',
                    'temperature': '4.1',
                },
            },
        },
    }
    folder_model.save.assert_not_called()
    item_model.move.assert_not_called()
    file_model.save.assert_not_called()


@patch('dive_server.crud_dataset.File')
@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_load_frame_metadata_omits_multicam_frame_on_distinct_record_collision(
    get_clone_root,
    valid_images,
    folder_cls,
    item_cls,
    file_cls,
):
    parent = _multicam_parent_folder()
    port = _camera_folder('port-id', 'port')
    starboard = _camera_folder('starboard-id', 'starboard')
    parent_root = _root_folder('parent-root-id', 'parent-root')
    port_root = _root_folder('port-root-id', 'port-root')
    starboard_root = _root_folder('starboard-root-id', 'starboard-root')
    user = {'_id': 'user-id'}

    folder_model = folder_cls.return_value
    _wire_multicam_folders(
        folder_model,
        {'port-id': port, 'starboard-id': starboard},
        {
            'parent-root-id': [_source_item('navigation.txt')],
            'port-root-id': [_source_item('port_override.txt')],
            'starboard-root-id': [],
        },
    )
    _wire_multicam_clone_roots(
        get_clone_root,
        {
            'parent-id': parent_root,
            'port-id': port_root,
            'starboard-id': starboard_root,
        },
    )
    _wire_multicam_valid_images(
        valid_images,
        {
            'port-id': [_image_item('port_0001.jpg'), _image_item('port_0002.jpg')],
            'starboard-id': [
                _image_item('starboard_0001.jpg'),
                _image_item('starboard_0002.jpg'),
            ],
        },
    )
    item_model = item_cls.return_value
    file_model = file_cls.return_value
    _wire_item_downloads(
        item_model,
        file_model,
        {
            'navigation.txt': (
                "port_image,starboard_image,depth\n"
                "port_0001.jpg,starboard_0001.jpg,192.80\n"
                "port_0002.jpg,starboard_0002.jpg,193.10\n"
            ),
            'port_override.txt': (
                "port_image,starboard_image,depth\n"
                "port_0001.jpg,starboard_0001.jpg,999.99\n"
                "port_0002.jpg,starboard_0002.jpg,193.10\n"
            ),
        },
    )

    result = crud_dataset.load_frame_metadata(parent, user, startFrame=0, endFrame=1)

    assert result == {
        'cameras': {
            'port': {
                '1': {
                    'port_image': 'port_0002.jpg',
                    'starboard_image': 'starboard_0002.jpg',
                    'depth': '193.10',
                },
            },
            'starboard': {
                '0': {
                    'port_image': 'port_0001.jpg',
                    'starboard_image': 'starboard_0001.jpg',
                    'depth': '192.80',
                },
                '1': {
                    'port_image': 'port_0002.jpg',
                    'starboard_image': 'starboard_0002.jpg',
                    'depth': '193.10',
                },
            },
        },
    }
    folder_model.save.assert_not_called()
    item_model.move.assert_not_called()
    file_model.save.assert_not_called()
