from unittest.mock import MagicMock, patch

import pytest
from girder.exceptions import RestException

from dive_server import crud, crud_dataset
from dive_utils import constants


def _child_folder(folder_id: str, name: str, fps=5, media_type='image-sequence', image_count=2):
    return {
        '_id': folder_id,
        'name': name,
        'parentId': 'multi-id',
        'meta': {
            'annotate': True,
            'type': media_type,
            'fps': fps,
        },
    }


def _dataset_parent():
    return {'_id': 'multi-id', 'name': 'stereo-set'}


@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_create_multicam_links_children(_verify, valid_images_mock, folder_cls, _aux):
    user = {'login': 'tester'}
    dataset_parent = _dataset_parent()
    left = _child_folder('left-id', 'left')
    right = _child_folder('right-id', 'right')

    def load_folder(folder_id, level=None, user=None):
        if folder_id == 'left-id':
            return left
        if folder_id == 'right-id':
            return right
        return None

    folder_cls.return_value.load.side_effect = load_folder
    valid_images_mock.return_value = [MagicMock(), MagicMock()]

    data = {
        'name': 'stereo-set',
        'fps': 5,
        'type': 'image-sequence',
        'subType': 'stereo',
        'defaultDisplay': 'left',
        'cameraOrder': ['left', 'right'],
        'cameras': {
            'left': {'folderId': 'left-id'},
            'right': {'folderId': 'right-id'},
        },
    }

    result = crud_dataset.create_multicam(user, dataset_parent, data)

    assert result == dataset_parent
    folder_cls.return_value.createFolder.assert_not_called()
    folder_cls.return_value.move.assert_not_called()
    saved_meta = folder_cls.return_value.save.call_args_list[-1][0][0]['meta']
    assert saved_meta[constants.TypeMarker] == constants.MultiType
    assert saved_meta[constants.SubTypeMarker] == 'stereo'
    assert saved_meta[constants.MultiCamMarker]['cameraOrder'] == ['left', 'right']
    assert set(saved_meta[constants.MultiCamMarker]['cameras'].keys()) == {'left', 'right'}


@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_create_multicam_rejects_mismatched_frame_counts(_verify, folder_cls, valid_images_mock):
    user = {'login': 'tester'}
    left = _child_folder('left-id', 'cam-left')
    right = _child_folder('right-id', 'cam-right')

    folder_cls.return_value.load.side_effect = lambda fid, **kwargs: {
        'left-id': left,
        'right-id': right,
    }[fid]
    valid_images_mock.side_effect = [[MagicMock()], [MagicMock(), MagicMock()]]

    data = {
        'name': 'stereo-set',
        'fps': 5,
        'type': 'image-sequence',
        'subType': 'stereo',
        'defaultDisplay': 'left',
        'cameras': {
            'left': {'folderId': 'left-id'},
            'right': {'folderId': 'right-id'},
        },
    }

    with pytest.raises(RestException, match='same number of frames'):
        crud_dataset.create_multicam(user, _dataset_parent(), data)


@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_create_multicam_accepts_video_fps_sentinel(_verify, folder_cls, _aux, item_cls):
    user = {'login': 'tester'}
    dataset_parent = _dataset_parent()
    left = _child_folder('left-id', 'left', fps=10.0, media_type='video')
    right = _child_folder('right-id', 'right', fps=10.0, media_type='video')

    folder_cls.return_value.load.side_effect = lambda fid, **kwargs: {
        'left-id': left,
        'right-id': right,
    }[fid]
    item_cls.return_value.findOne.return_value = {'_id': 'video-item'}

    data = {
        'name': 'stereo-set',
        'fps': -1,
        'type': 'video',
        'subType': 'stereo',
        'defaultDisplay': 'left',
        'cameraOrder': ['left', 'right'],
        'cameras': {
            'left': {'folderId': 'left-id'},
            'right': {'folderId': 'right-id'},
        },
    }

    result = crud_dataset.create_multicam(user, dataset_parent, data)

    assert result == dataset_parent
    saved_meta = folder_cls.return_value.save.call_args_list[-1][0][0]['meta']
    assert saved_meta[constants.FPSMarker] == 10.0


@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_create_multicam_rejects_wrong_default_display(_verify, folder_cls, valid_images_mock):
    user = {'login': 'tester'}
    left = _child_folder('left-id', 'cam-left')
    right = _child_folder('right-id', 'cam-right')
    folder_cls.return_value.load.side_effect = lambda fid, **kwargs: {
        'left-id': left,
        'right-id': right,
    }[fid]
    valid_images_mock.return_value = [MagicMock(), MagicMock()]

    data = {
        'name': 'stereo-set',
        'fps': 5,
        'type': 'image-sequence',
        'subType': 'stereo',
        'defaultDisplay': 'missing',
        'cameras': {
            'left': {'folderId': 'left-id'},
            'right': {'folderId': 'right-id'},
        },
    }

    with pytest.raises(RestException, match='defaultDisplay'):
        crud_dataset.create_multicam(user, _dataset_parent(), data)
