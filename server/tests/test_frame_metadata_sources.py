from unittest.mock import patch

from girder.exceptions import AccessException, RestException
import pytest

from dive_server import crud_dataset
from dive_server.views_dataset import DatasetResource
from dive_utils import constants


def _dataset_folder(dataset_type=constants.ImageSequenceType, clone_of=None):
    folder = {
        '_id': 'dataset-id',
        'name': 'single-camera',
        'meta': {'annotate': True, 'type': dataset_type, 'fps': 5},
    }
    if clone_of is not None:
        # Only a clone has a media source folder distinct from itself.
        folder[constants.ForeignMediaIdMarker] = clone_of
    return folder


def _root_folder(folder_id: str):
    return {'_id': folder_id, 'name': folder_id, 'meta': {}}


def _camera_folder(
    folder_id: str,
    name: str,
    dataset_type=constants.ImageSequenceType,
    clone_of=None,
):
    folder = {
        '_id': folder_id,
        'name': name,
        'meta': {'annotate': True, 'type': dataset_type, 'fps': 5},
    }
    if clone_of is not None:
        folder[constants.ForeignMediaIdMarker] = clone_of
    return folder


def _multicam_parent_folder(clone_of=None):
    folder = {
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
    if clone_of is not None:
        folder[constants.ForeignMediaIdMarker] = clone_of
    return folder


def _source_item(name: str):
    return {'_id': f'{name}-id', 'name': name}


def _descriptor(name: str):
    return {'itemId': f'{name}-id', 'name': name}


def _child_items_by_folder(folder_model, items_by_folder_id):
    # Apply the reserved-name filter the way Mongo does, so the mock can never hand the
    # resolver an item the real query would have excluded.
    def child_items(folder, filters=None):
        items = items_by_folder_id.get(folder['_id'], [])
        allowed = ((filters or {}).get('lowerName') or {}).get('$in')
        if allowed is None:
            return items
        return [item for item in items if item['name'].lower() in allowed]

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
@pytest.mark.parametrize(
    'dataset_type',
    [constants.ImageSequenceType, constants.VideoType],
)
def test_sources_single_camera_uses_one_reserved_name_fallback(
    get_clone_root,
    folder_cls,
    dataset_type,
):
    dataset = _dataset_folder(dataset_type)
    get_clone_root.return_value = dataset
    folder_cls.return_value.childItems.return_value = [_source_item('frame_metadata.csv')]

    assert crud_dataset.load_frame_metadata_sources(dataset, {'_id': 'user-id'}) == {
        'shared': _descriptor('frame_metadata.csv'),
        'cameras': {},
    }
    # The query is the only reserved-name filter on this path: nothing it returns is
    # re-checked in Python, so it is pinned literally here.
    folder_cls.return_value.childItems.assert_called_once_with(
        dataset,
        filters={
            'lowerName': {
                '$in': [
                    'frame-metadata.csv',
                    'frame-metadata.json',
                    'frame-metadata.txt',
                    'frame_metadata.csv',
                    'frame_metadata.json',
                    'frame_metadata.txt',
                ]
            }
        },
    )


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_report_ambiguous_reserved_name_fallback(get_clone_root, folder_cls):
    dataset = _dataset_folder()
    get_clone_root.return_value = dataset
    folder_cls.return_value.childItems.return_value = [
        _source_item('frame_metadata.csv'),
        _source_item('frame-metadata.txt'),
    ]

    assert crud_dataset.load_frame_metadata_sources(dataset, {'_id': 'user-id'}) == {
        'shared': {
            'name': 'Metadata File',
            'error': 'More than one reserved-name metadata attachment is available.',
        },
        'cameras': {},
    }


@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
@pytest.mark.parametrize(
    'dataset_type',
    [constants.ImageSequenceType, constants.VideoType],
)
def test_sources_single_camera_reads_explicit_attachment_from_clone_root(
    get_clone_root,
    item_cls,
    dataset_type,
):
    dataset = _dataset_folder(dataset_type, clone_of='source-root-id')
    source_root = _root_folder('source-root-id')
    source_root['meta'].update(
        {
            constants.MetadataFileItemIdMarker: 'source-item-id',
            constants.MetadataFileOriginalNameMarker: 'flight.json',
        }
    )
    get_clone_root.return_value = source_root
    item_cls.return_value.load.return_value = {
        '_id': 'source-item-id',
        'folderId': 'source-root-id',
        'name': 'stored.json',
    }

    assert crud_dataset.load_frame_metadata_sources(dataset, {'_id': 'user-id'}) == {
        'shared': {'itemId': 'source-item-id', 'name': 'flight.json'},
        'cameras': {},
    }


@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_clone_root_attachment_does_not_need_the_callers_acl(
    get_clone_root,
    item_cls,
):
    """Scope membership is the guard, not the caller's access to the clone root.

    getCloneRoot force-loads the source folder, so the caller may have no READ on it; an
    access-checked item load would raise AccessException and 403 the panel for a clone whose
    source was unshared, even though crud.valid_images already lists that root's media.
    """
    dataset = _dataset_folder(clone_of='source-root-id')
    source_root = _root_folder('source-root-id')
    source_root['meta'].update(
        {
            constants.MetadataFileItemIdMarker: 'source-item-id',
            constants.MetadataFileOriginalNameMarker: 'flight.json',
        }
    )
    get_clone_root.return_value = source_root

    def load_item(item_id, level=None, user=None, force=False):
        if not force:
            raise AccessException('Read access denied for folder source-root-id.')
        return {'_id': 'source-item-id', 'folderId': 'source-root-id', 'name': 'stored.json'}

    item_cls.return_value.load.side_effect = load_item

    assert crud_dataset.load_frame_metadata_sources(dataset, {'_id': 'user-id'}) == {
        'shared': {'itemId': 'source-item-id', 'name': 'flight.json'},
        'cameras': {},
    }


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_single_camera_no_attachment_returns_empty(get_clone_root, folder_cls):
    dataset = _dataset_folder()
    get_clone_root.return_value = dataset
    folder_cls.return_value.childItems.return_value = []

    assert crud_dataset.load_frame_metadata_sources(dataset, {'_id': 'user-id'}) == {'cameras': {}}


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_large_image_returns_empty(get_clone_root, folder_cls):
    dataset = {
        '_id': 'ds',
        'name': 'x',
        'meta': {'annotate': True, 'type': constants.LargeImageType, 'fps': 5},
    }

    result = crud_dataset.load_frame_metadata_sources(dataset, {'_id': 'user-id'})

    # Non-image-sequence media types never expose sidecars; no folder is even walked.
    assert result == {'cameras': {}}
    folder_cls.return_value.childItems.assert_not_called()
    get_clone_root.assert_not_called()


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_multicam_returns_shared_once_and_camera_local_once(get_clone_root, folder_cls):
    # A cloned multicam: every folder's attachment lives in its media source root.
    parent = _multicam_parent_folder(clone_of='parent-root-id')
    port = _camera_folder('port-id', 'port', clone_of='port-root-id')
    starboard = _camera_folder('starboard-id', 'starboard', clone_of='starboard-root-id')
    parent_root = _root_folder('parent-root-id')
    port_root = _root_folder('port-root-id')
    starboard_root = _root_folder('starboard-root-id')
    user = {'_id': 'user-id'}

    folder_model = folder_cls.return_value
    _wire_multicam_folders(folder_model, {'port-id': port, 'starboard-id': starboard})
    _child_items_by_folder(
        folder_model,
        {
            'port-id': [_source_item('frame_metadata.csv')],
            'port-root-id': [],
            'starboard-id': [],
            'starboard-root-id': [],
            'parent-id': [],
            'parent-root-id': [_source_item('frame-metadata.txt')],
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

    assert result == {
        'shared': _descriptor('frame-metadata.txt'),
        'cameras': {
            'port': _descriptor('frame_metadata.csv'),
        },
    }


@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_camera_reserved_name_replaces_shared_explicit_attachment(
    get_clone_root,
    folder_cls,
    item_cls,
):
    """A camera-local attachment replaces the shared one for that camera, however declared."""
    parent = _multicam_parent_folder()
    parent['meta'].update(
        {
            constants.MetadataFileItemIdMarker: 'shared-id',
            constants.MetadataFileOriginalNameMarker: 'shared.csv',
        }
    )
    port = _camera_folder('port-id', 'port')
    starboard = _camera_folder('starboard-id', 'starboard')
    parent_root = _root_folder('parent-root-id')
    folder_model = folder_cls.return_value
    _wire_multicam_folders(folder_model, {'port-id': port, 'starboard-id': starboard})
    _child_items_by_folder(
        folder_model,
        {
            'port-id': [_source_item('frame_metadata.csv')],
            'port-root-id': [],
            'starboard-id': [],
            'starboard-root-id': [],
        },
    )
    item_cls.return_value.load.return_value = {
        '_id': 'shared-id',
        'folderId': 'parent-id',
        'name': 'stored.csv',
    }
    _wire_clone_roots(
        get_clone_root,
        {
            'parent-id': parent_root,
            'port-id': _root_folder('port-root-id'),
            'starboard-id': _root_folder('starboard-root-id'),
        },
    )

    assert crud_dataset.load_frame_metadata_sources(parent, {'_id': 'user-id'}) == {
        'shared': {'itemId': 'shared-id', 'name': 'shared.csv'},
        'cameras': {'port': _descriptor('frame_metadata.csv')},
    }


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_multicam_skips_large_image_camera(get_clone_root, folder_cls):
    parent = _multicam_parent_folder()
    port = _camera_folder('port-id', 'port')
    starboard = {
        '_id': 'starboard-id',
        'name': 'starboard',
        'meta': {'type': constants.LargeImageType},
    }
    parent_root = _root_folder('parent-root-id')
    user = {'_id': 'user-id'}

    folder_model = folder_cls.return_value
    _wire_multicam_folders(folder_model, {'port-id': port, 'starboard-id': starboard})
    _child_items_by_folder(
        folder_model,
        {
            'port-id': [_source_item('frame_metadata.csv')],
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

    assert result == {'cameras': {'port': _descriptor('frame_metadata.csv')}}


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_multicam_includes_video_camera(get_clone_root, folder_cls):
    parent = _multicam_parent_folder()
    port = _camera_folder('port-id', 'port', constants.VideoType)
    starboard = _camera_folder('starboard-id', 'starboard', constants.LargeImageType)
    parent_root = _root_folder('parent-root-id')
    port_root = _root_folder('port-root-id')
    user = {'_id': 'user-id'}

    folder_model = folder_cls.return_value
    _wire_multicam_folders(folder_model, {'port-id': port, 'starboard-id': starboard})
    _child_items_by_folder(
        folder_model,
        {
            'port-id': [_source_item('frame_metadata.csv')],
            'port-root-id': [],
            'parent-id': [],
            'parent-root-id': [],
        },
    )
    _wire_clone_roots(
        get_clone_root,
        {'parent-id': parent_root, 'port-id': port_root},
    )

    result = crud_dataset.load_frame_metadata_sources(parent, user)

    assert result == {'cameras': {'port': _descriptor('frame_metadata.csv')}}


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_multicam_missing_camera_folder_raises_404(get_clone_root, folder_cls):
    parent = _multicam_parent_folder()
    user = {'_id': 'user-id'}
    get_clone_root.return_value = _root_folder('parent-root-id')
    _wire_multicam_folders(folder_cls.return_value, {})

    with pytest.raises(RestException, match='Camera folder for "port" was not found') as exc_info:
        crud_dataset.load_frame_metadata_sources(parent, user)

    assert exc_info.value.code == 404


@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_expose_selected_metadata_attachment_once_as_shared(get_clone_root, item_cls):
    dataset = _dataset_folder()
    dataset['meta'][constants.MetadataFileItemIdMarker] = 'flight_log.csv-id'
    dataset['meta'][constants.MetadataFileOriginalNameMarker] = 'flight_log.csv'
    user = {'_id': 'user-id'}
    get_clone_root.return_value = dataset
    item_cls.return_value.load.return_value = {
        '_id': 'flight_log.csv-id',
        'folderId': 'dataset-id',
        'name': 'stored.csv',
    }

    # The selected metadata attachment is a frame metadata source without another marker or
    # association. A pipeline still receives this exact item even if its rows do not match.
    assert crud_dataset.load_frame_metadata_sources(dataset, user) == {
        'shared': {
            'itemId': 'flight_log.csv-id',
            'name': 'flight_log.csv',
        },
        'cameras': {},
    }


@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_fall_back_to_item_name_when_original_name_is_absent(
    get_clone_root,
    item_cls,
):
    dataset = _dataset_folder()
    dataset['meta'][constants.MetadataFileItemIdMarker] = 'flight_log.csv-id'
    user = {'_id': 'user-id'}
    get_clone_root.return_value = dataset
    item_cls.return_value.load.return_value = {
        '_id': 'flight_log.csv-id',
        'folderId': 'dataset-id',
        'name': 'flight_log.csv',
    }

    assert crud_dataset.load_frame_metadata_sources(dataset, user) == {
        'shared': {
            'itemId': 'flight_log.csv-id',
            'name': 'flight_log.csv',
        },
        'cameras': {},
    }


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
def test_sources_keep_missing_explicit_attachment_visible_without_reserved_fallback(
    get_clone_root,
    item_cls,
    folder_cls,
):
    dataset = _dataset_folder()
    dataset['meta'][constants.MetadataFileItemIdMarker] = 'missing-id'
    dataset['meta'][constants.MetadataFileOriginalNameMarker] = 'missing.csv'
    get_clone_root.return_value = dataset
    item_cls.return_value.load.return_value = None

    assert crud_dataset.load_frame_metadata_sources(dataset, {'_id': 'user-id'}) == {
        'shared': {
            'name': 'missing.csv',
            'error': 'Metadata attachment is unavailable.',
        },
        'cameras': {},
    }
    folder_cls.return_value.childItems.assert_not_called()


@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.Item')
def test_replace_attachment_removes_owned_previous_item_after_record_save(
    item_cls,
    folder_cls,
    get_clone_root,
):
    dataset = _dataset_folder()
    dataset['meta'][constants.MetadataFileItemIdMarker] = 'old-id'
    get_clone_root.return_value = dataset
    new_item = {'_id': 'new-id', 'folderId': 'dataset-id', 'name': 'new.csv'}
    old_item = {'_id': 'old-id', 'folderId': 'dataset-id', 'name': 'old.csv'}
    # The superseded id is read straight off the marker, so the loads are: validate the
    # replacement, then load the superseded item for removal.
    item_cls.return_value.load.side_effect = [new_item, old_item]

    result = crud_dataset.set_metadata_file({'_id': 'user-id'}, dataset, 'new-id')

    assert result == {
        'metadataFileItemId': 'new-id',
        'metadataFileOriginalName': 'new.csv',
    }
    folder_cls.return_value.save.assert_called_once_with(dataset)
    item_cls.return_value.remove.assert_called_once_with(old_item)


@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.Item')
def test_replace_reserved_name_attachment_keeps_it(item_cls, folder_cls, get_clone_root):
    """A reserved-name file is the user's own content: it is shadowed, never deleted."""
    dataset = _dataset_folder()
    get_clone_root.return_value = dataset
    reserved_item = {
        '_id': 'frame_metadata.csv-id',
        'folderId': 'dataset-id',
        'name': 'frame_metadata.csv',
    }
    new_item = {'_id': 'new-id', 'folderId': 'dataset-id', 'name': 'new.csv'}
    folder_cls.return_value.childItems.return_value = [reserved_item]
    item_cls.return_value.load.side_effect = [new_item]

    crud_dataset.set_metadata_file({'_id': 'user-id'}, dataset, 'new-id')

    item_cls.return_value.remove.assert_not_called()
    assert dataset['meta'][constants.MetadataFileItemIdMarker] == 'new-id'


@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.Item')
def test_replace_marked_reserved_name_attachment_keeps_it(item_cls, folder_cls, get_clone_root):
    """The marker cannot vouch for ownership: process_items records what it discovers in it.

    A reserved-name file uploaded alongside the media is swept, marked, and left in place.
    Deleting it here as a superseded attachment would destroy a file the user uploaded, so
    ownership is decided by the reserved-name predicate, not by the marker's presence.
    """
    dataset = _dataset_folder()
    dataset['meta'][constants.MetadataFileItemIdMarker] = 'swept-id'
    get_clone_root.return_value = dataset
    new_item = {'_id': 'new-id', 'folderId': 'dataset-id', 'name': 'new.csv'}
    swept_item = {'_id': 'swept-id', 'folderId': 'dataset-id', 'name': 'frame_metadata.csv'}
    item_cls.return_value.load.side_effect = [new_item, swept_item]

    crud_dataset.set_metadata_file({'_id': 'user-id'}, dataset, 'new-id')

    item_cls.return_value.remove.assert_not_called()
    assert dataset['meta'][constants.MetadataFileItemIdMarker] == 'new-id'


@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.Item')
def test_replace_clone_attachment_does_not_remove_source_item(
    item_cls,
    folder_cls,
    get_clone_root,
):
    dataset = _dataset_folder()
    dataset[constants.ForeignMediaIdMarker] = 'source-root-id'
    dataset['meta'][constants.MetadataFileItemIdMarker] = 'source-id'
    get_clone_root.return_value = _root_folder('source-root-id')
    new_item = {'_id': 'new-id', 'folderId': 'dataset-id', 'name': 'new.csv'}
    source_item = {'_id': 'source-id', 'folderId': 'source-root-id', 'name': 'source.csv'}
    item_cls.return_value.load.side_effect = [new_item, source_item]

    crud_dataset.set_metadata_file({'_id': 'user-id'}, dataset, 'new-id')

    folder_cls.return_value.save.assert_called_once_with(dataset)
    item_cls.return_value.remove.assert_not_called()


@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.cherrypy.log')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.Item')
def test_replace_attachment_stays_successful_when_old_item_cleanup_fails(
    item_cls,
    folder_cls,
    log,
    get_clone_root,
):
    dataset = _dataset_folder()
    dataset['meta'][constants.MetadataFileItemIdMarker] = 'old-id'
    get_clone_root.return_value = dataset
    new_item = {'_id': 'new-id', 'folderId': 'dataset-id', 'name': 'new.csv'}
    old_item = {'_id': 'old-id', 'folderId': 'dataset-id', 'name': 'old.csv'}
    item_cls.return_value.load.side_effect = [new_item, old_item]
    item_cls.return_value.remove.side_effect = RuntimeError('cleanup failed')

    result = crud_dataset.set_metadata_file({'_id': 'user-id'}, dataset, 'new-id')

    assert result['metadataFileItemId'] == 'new-id'
    folder_cls.return_value.save.assert_called_once_with(dataset)
    log.assert_called_once()


@patch('girder.api.rest.Resource.route')
def test_dataset_resource_registers_frame_metadata_sources_route(route):
    with patch('dive_server.views_dataset.Folder'):
        resource = DatasetResource('dive_dataset')

    assert any(
        call.args == ("GET", (":id", "frame_metadata_sources"), resource.get_frame_metadata_sources)
        for call in route.call_args_list
    )
