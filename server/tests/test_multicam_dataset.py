from unittest.mock import patch

from girder.constants import AccessType
from girder.exceptions import RestException
import pytest

from dive_server import crud, crud_dataset
from dive_utils import constants
from dive_utils.models import DatasetSourceMedia, GirderMetadataStatic, MediaResource


def _multi_parent_folder():
    return {
        '_id': 'parent-id',
        'name': 'stereo-dataset',
        'created': '2020-01-01T00:00:00',
        'meta': {
            'annotate': True,
            'type': constants.MultiType,
            'fps': 5,
            'subType': 'stereo',
            'multiCam': {
                'defaultDisplay': 'left',
                'cameraOrder': ['left', 'right'],
                'cameras': {
                    'left': {'folderId': 'left-id', 'type': 'image-sequence'},
                    'right': {'folderId': 'right-id', 'type': 'image-sequence'},
                },
            },
        },
    }


def _child_folder(folder_id: str, name: str):
    return {
        '_id': folder_id,
        'name': name,
        'meta': {
            'annotate': True,
            'type': 'image-sequence',
            'fps': 5,
        },
    }


class TestTrainingAllowedFolder:
    @patch('dive_server.crud.Folder')
    def test_rejects_multicam_parent(self, folder_cls):
        user = {'login': 'tester'}
        with pytest.raises(RestException, match='stereoscopic or multicamera'):
            crud.assert_training_allowed_folder(user, _multi_parent_folder())
        folder_cls.return_value.load.assert_not_called()

    @patch('dive_server.crud.Folder')
    def test_rejects_camera_child_of_multicam(self, folder_cls):
        user = {'login': 'tester'}
        child = _child_folder('left-id', 'left')
        child['parentId'] = 'parent-id'
        folder_cls.return_value.load.return_value = _multi_parent_folder()
        with pytest.raises(RestException, match='cameras within a multicamera'):
            crud.assert_training_allowed_folder(user, child)
        folder_cls.return_value.load.assert_called_once_with(
            'parent-id',
            level=AccessType.READ,
            user=user,
        )

    @patch('dive_server.crud.Folder')
    def test_allows_single_camera_dataset(self, folder_cls):
        user = {'login': 'tester'}
        folder_cls.return_value.load.return_value = None
        crud.assert_training_allowed_folder(user, _child_folder('solo-id', 'solo'))


class TestVerifyDatasetMulti:
    def test_accepts_valid_multi_dataset(self):
        crud.verify_dataset(_multi_parent_folder())

    def test_rejects_multi_without_fps(self):
        folder = _multi_parent_folder()
        folder['meta'].pop('fps')
        with pytest.raises(ValueError, match='missing numerical fps'):
            crud.verify_dataset(folder)

    def test_rejects_multi_without_multicam_config(self):
        folder = _multi_parent_folder()
        folder['meta'].pop('multiCam')
        with pytest.raises(ValueError, match='multiCam.defaultDisplay'):
            crud.verify_dataset(folder)


@patch('dive_server.crud_dataset.get_media')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_get_dataset_includes_multicam_media(_verify, folder_cls, get_media_mock):
    parent = _multi_parent_folder()
    user = {'login': 'tester'}

    def load_folder(folder_id, level=None, user=None):
        if folder_id == 'left-id':
            return _child_folder('left-id', 'left')
        if folder_id == 'right-id':
            return _child_folder('right-id', 'right')
        return None

    folder_cls.return_value.load.side_effect = load_folder

    left_image = MediaResource(
        id='img-left',
        url='/api/v1/.../left.png',
        filename='left_20230615_143022.png',
        timestamp=1686839422.0,
    )
    right_image = MediaResource(id='img-right', url='/api/v1/.../right.png', filename='right.png')

    def media_for_child(child_folder, child_user):
        if child_folder['_id'] == 'left-id':
            return DatasetSourceMedia(imageData=[left_image], video=None, sourceVideo=None)
        return DatasetSourceMedia(imageData=[right_image], video=None, sourceVideo=None)

    get_media_mock.side_effect = media_for_child

    result = crud_dataset.get_dataset(parent, user)

    assert isinstance(result, GirderMetadataStatic)
    assert result.type == constants.MultiType
    assert result.subType == 'stereo'
    assert result.multiCamMedia is not None
    assert result.multiCamMedia.defaultDisplay == 'left'
    assert result.multiCamMedia.cameraOrder == ['left', 'right']
    assert set(result.multiCamMedia.cameras.keys()) == {'left', 'right'}
    assert result.multiCamMedia.cameras['left'].imageData[0].filename == 'left_20230615_143022.png'
    assert result.multiCamMedia.cameras['left'].imageData[0].timestamp == 1686839422.0
    assert result.multiCamMedia.cameras['right'].imageData[0].timestamp is None
    assert 'multiCam' not in result.dict()


@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_get_media_multi_parent_returns_empty(_verify):
    parent = _multi_parent_folder()
    user = {'login': 'tester'}

    result = crud_dataset.get_media(parent, user)

    assert result.imageData == []
    assert result.video is None
    assert result.sourceVideo is None


@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_get_media_image_sequence_parses_frame_timestamps(_verify, valid_images_mock):
    folder = _child_folder('left-id', 'left')
    user = {'login': 'tester'}
    valid_images_mock.return_value = [
        {'_id': 'img-parseable', 'name': 'left_20230615_143022.png'},
        {'_id': 'img-unparseable', 'name': 'left_00001.png'},
    ]

    result = crud_dataset.get_media(folder, user)

    assert result.imageData[0].timestamp == 1686839422.0
    assert result.imageData[1].timestamp is None


@patch('dive_server.crud_dataset.get_media')
@patch('dive_server.crud_dataset.Folder')
def test_get_multi_cam_media_missing_child_raises(folder_cls, get_media_mock):
    folder_cls.return_value.load.return_value = None
    parent = _multi_parent_folder()
    user = {'login': 'tester'}

    with pytest.raises(RestException, match='not found'):
        crud_dataset.get_multi_cam_media(parent, user)

    get_media_mock.assert_not_called()
