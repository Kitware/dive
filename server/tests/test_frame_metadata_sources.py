from unittest.mock import patch

from girder.exceptions import RestException
import pytest

from dive_server import crud_dataset
from dive_server.views_dataset import DatasetResource
from dive_utils import constants


def _dataset_folder():
    return {
        '_id': 'dataset-id',
        'name': 'single-camera',
        'meta': {'annotate': True, 'type': constants.ImageSequenceType},
    }


def _clone_dataset_folder(folder_id: str):
    return {
        '_id': folder_id,
        'name': folder_id,
        'meta': {'annotate': True, 'type': constants.ImageSequenceType},
    }


def _root_folder(folder_id: str):
    return {'_id': folder_id, 'name': folder_id, 'meta': {}}


def _camera_folder(folder_id: str, name: str):
    return {
        '_id': folder_id,
        'name': name,
        'meta': {'annotate': True, 'type': constants.ImageSequenceType, 'fps': 5},
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


def _source_item(name: str):
    return {'_id': f'{name}-id', 'name': name}


def _descriptor(name: str):
    return {'itemId': f'{name}-id', 'name': name}


def _child_items_by_folder(folder_model, items_by_folder_id):
    def child_items(folder):
        return items_by_folder_id.get(folder['_id'], [])

    folder_model.childItems.side_effect = child_items


def _wire_multicam_folders(folder_model, children):
    def load_folder(folder_id, level=None, user=None):
        return children.get(folder_id)

    folder_model.load.side_effect = load_folder


def _wire_clone_roots(get_clone_root, roots_by_folder_id):
    def clone_root(user, folder):
        return roots_by_folder_id[folder['_id']]

    get_clone_root.side_effect = clone_root


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_single_camera_co_located_name_sorted_and_deduped(get_clone_root, folder_cls):
    dataset = _dataset_folder()
    user = {'_id': 'user-id'}
    # Co-located (non-clone): the media root is the dataset folder itself, so it is listed once.
    get_clone_root.return_value = dataset
    folder_model = folder_cls.return_value
    folder_model.childItems.return_value = [
        _source_item('image_0001.jpg'),
        _source_item('beta.meta.csv'),
        _source_item('Alpha.meta.csv'),
        _source_item('frame_metadata.json'),
    ]

    result = crud_dataset.load_frame_metadata_sources(dataset, user)

    # Only declared sidecars, name-sorted case-insensitively, keyed by the single-camera key.
    assert result == {
        'cameras': {
            'singleCam': [_descriptor('Alpha.meta.csv'), _descriptor('beta.meta.csv')],
        },
    }
    folder_model.childItems.assert_called_once_with(dataset)


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_single_camera_clone_local_precedes_root(get_clone_root, folder_cls):
    clone = _clone_dataset_folder('clone-id')
    source_root = _root_folder('source-root-id')
    user = {'_id': 'user-id'}
    get_clone_root.return_value = source_root
    folder_model = folder_cls.return_value
    _child_items_by_folder(
        folder_model,
        {
            'clone-id': [_source_item('local.meta.csv')],
            'source-root-id': [_source_item('root.meta.csv'), _source_item('image_0001.jpg')],
        },
    )

    result = crud_dataset.load_frame_metadata_sources(clone, user)

    # Precedence: the clone-local sidecar is listed before the media-root sidecar.
    assert result == {
        'cameras': {
            'singleCam': [_descriptor('local.meta.csv'), _descriptor('root.meta.csv')],
        },
    }


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_single_camera_no_sidecars_returns_empty(get_clone_root, folder_cls):
    dataset = _dataset_folder()
    user = {'_id': 'user-id'}
    get_clone_root.return_value = dataset
    folder_cls.return_value.childItems.return_value = [
        _source_item('image_0001.jpg'),
        _source_item('frame_metadata.json'),
    ]

    result = crud_dataset.load_frame_metadata_sources(dataset, user)

    assert result == {'cameras': {}}


@pytest.mark.parametrize('dataset_type', [constants.VideoType, constants.LargeImageType])
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_unsupported_media_type_returns_empty(get_clone_root, folder_cls, dataset_type):
    dataset = {
        '_id': 'ds',
        'name': 'x',
        'meta': {'annotate': True, 'type': dataset_type, 'fps': 5},
    }

    result = crud_dataset.load_frame_metadata_sources(dataset, {'_id': 'user-id'})

    # Non-image-sequence media types never expose sidecars; no folder is even walked.
    assert result == {'cameras': {}}
    folder_cls.return_value.childItems.assert_not_called()
    get_clone_root.assert_not_called()


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_multicam_routes_per_camera_with_shared_parent_root(get_clone_root, folder_cls):
    parent = _multicam_parent_folder()
    port = _camera_folder('port-id', 'port')
    starboard = _camera_folder('starboard-id', 'starboard')
    parent_root = _root_folder('parent-root-id')
    port_root = _root_folder('port-root-id')
    starboard_root = _root_folder('starboard-root-id')
    user = {'_id': 'user-id'}

    folder_model = folder_cls.return_value
    _wire_multicam_folders(folder_model, {'port-id': port, 'starboard-id': starboard})
    _child_items_by_folder(
        folder_model,
        {
            'port-id': [_source_item('port_local.meta.csv')],
            'port-root-id': [],
            'starboard-id': [],
            'starboard-root-id': [],
            'parent-id': [],
            'parent-root-id': [_source_item('shared.meta.csv')],
        },
    )
    _wire_clone_roots(
        get_clone_root,
        {
            'parent-id': parent_root,
            'port-id': port_root,
            'starboard-id': starboard_root,
        },
    )

    result = crud_dataset.load_frame_metadata_sources(parent, user)

    # Camera-local precedes the shared parent root; the shared sidecar binds both cameras.
    assert result == {
        'cameras': {
            'port': [_descriptor('port_local.meta.csv'), _descriptor('shared.meta.csv')],
            'starboard': [_descriptor('shared.meta.csv')],
        },
    }


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_multicam_skips_non_image_sequence_camera(get_clone_root, folder_cls):
    parent = _multicam_parent_folder()
    port = _camera_folder('port-id', 'port')
    starboard = {'_id': 'starboard-id', 'name': 'starboard', 'meta': {'type': constants.VideoType}}
    parent_root = _root_folder('parent-root-id')
    user = {'_id': 'user-id'}

    folder_model = folder_cls.return_value
    _wire_multicam_folders(folder_model, {'port-id': port, 'starboard-id': starboard})
    _child_items_by_folder(
        folder_model,
        {
            'port-id': [_source_item('port.meta.csv')],
            'port-root-id': [],
            'parent-id': [],
            'parent-root-id': [],
        },
    )
    _wire_clone_roots(
        get_clone_root,
        {'parent-id': parent_root, 'port-id': _root_folder('port-root-id')},
    )

    result = crud_dataset.load_frame_metadata_sources(parent, user)

    # The video camera is skipped entirely; only the image-sequence camera is keyed.
    assert result == {'cameras': {'port': [_descriptor('port.meta.csv')]}}


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_multicam_missing_folder_id_raises_400(get_clone_root, folder_cls):
    parent = _multicam_parent_folder()
    # Drop folderId from the first camera in order so the guard fires before any folder load.
    parent['meta']['multiCam']['cameras']['port'].pop('folderId')
    user = {'_id': 'user-id'}
    get_clone_root.return_value = _root_folder('parent-root-id')

    with pytest.raises(RestException, match='Camera "port" missing folderId') as exc_info:
        crud_dataset._load_multicam_frame_metadata_sources(parent, user)

    assert exc_info.value.code == 400


@patch('girder.api.rest.Resource.route')
def test_dataset_resource_registers_frame_metadata_sources_route(route):
    with patch('dive_server.views_dataset.Folder'):
        resource = DatasetResource('dive_dataset')

    assert any(
        call.args == ("GET", (":id", "frame_metadata_sources"), resource.get_frame_metadata_sources)
        for call in route.call_args_list
    )


@patch('dive_server.views_dataset.crud_dataset.load_frame_metadata_sources')
def test_get_frame_metadata_sources_route_delegates(load_sources):
    dataset = _dataset_folder()
    user = {'_id': 'user-id'}
    load_sources.return_value = {'cameras': {'singleCam': [_descriptor('nav.meta.csv')]}}

    with patch('dive_server.views_dataset.Folder'):
        resource = DatasetResource('dive_dataset')
        resource.getCurrentUser = lambda: user
        method = DatasetResource.get_frame_metadata_sources.__wrapped__.__wrapped__
        result = method(resource, dataset)

    assert result == {'cameras': {'singleCam': [_descriptor('nav.meta.csv')]}}
    load_sources.assert_called_once_with(dataset, user)
