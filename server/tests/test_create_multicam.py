from unittest.mock import MagicMock, patch

from girder.exceptions import RestException
import pytest

from dive_server import crud_dataset
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


@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_create_multicam_accepts_mismatched_frame_counts(
    _verify, folder_cls, valid_images_mock, _aux, item_cls
):
    """Cameras with differing frame counts are paired downstream by frame alignment,
    so create_multicam must not reject them."""
    user = {'login': 'tester'}
    dataset_parent = _dataset_parent()
    left = _child_folder('left-id', 'left')
    right = _child_folder('right-id', 'right')

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
        'cameraOrder': ['left', 'right'],
        'cameras': {
            'left': {'folderId': 'left-id'},
            'right': {'folderId': 'right-id'},
        },
    }

    result = crud_dataset.create_multicam(user, dataset_parent, data)

    assert result == dataset_parent
    saved_meta = folder_cls.return_value.save.call_args_list[-1][0][0]['meta']
    assert saved_meta[constants.TypeMarker] == constants.MultiType


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


@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_create_multicam_accepts_image_sequence_fps_sentinel(
    _verify, valid_images_mock, folder_cls, _aux
):
    """Image-sequence children resolve fps -1 → 1 in post-process; create_multicam
    must accept request fps=-1 (auto) and take the children's rate."""
    user = {'login': 'tester'}
    dataset_parent = _dataset_parent()
    left = _child_folder('left-id', 'left', fps=1.0, media_type='image-sequence')
    right = _child_folder('right-id', 'right', fps=1.0, media_type='image-sequence')
    star = _child_folder('star-id', 'STAR', fps=1.0, media_type='image-sequence')

    folder_cls.return_value.load.side_effect = lambda fid, **kwargs: {
        'left-id': left,
        'right-id': right,
        'star-id': star,
    }[fid]
    valid_images_mock.return_value = [MagicMock(), MagicMock()]

    data = {
        'name': 'stereo-set',
        'fps': -1,
        'type': 'image-sequence',
        'subType': 'multicam',
        'defaultDisplay': 'STAR',
        'cameraOrder': ['left', 'right', 'STAR'],
        'cameras': {
            'left': {'folderId': 'left-id'},
            'right': {'folderId': 'right-id'},
            'STAR': {'folderId': 'star-id'},
        },
    }

    result = crud_dataset.create_multicam(user, dataset_parent, data)

    assert result == dataset_parent
    saved_meta = folder_cls.return_value.save.call_args_list[-1][0][0]['meta']
    assert saved_meta[constants.FPSMarker] == 1.0


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


@patch('dive_server.crud_dataset._calibration_file_is_final_json', return_value=True)
@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_create_multicam_marks_calibration_in_dataset_folder(
    _verify,
    folder_cls,
    valid_images_mock,
    item_cls,
    _aux,
    _is_final_json,
):
    user = {'login': 'tester'}
    dataset_parent = _dataset_parent()
    left = _child_folder('left-id', 'left')
    right = _child_folder('right-id', 'right')
    cal_item = {
        '_id': 'cal-id',
        'name': 'stereo-cal.json',
        'folderId': 'multi-id',
        'meta': {},
    }

    folder_cls.return_value.load.side_effect = lambda fid, **kwargs: {
        'left-id': left,
        'right-id': right,
    }[fid]
    valid_images_mock.return_value = [MagicMock(), MagicMock()]
    item_cls.return_value.load.return_value = cal_item
    item_cls.return_value.childFiles.return_value = [{'name': 'stereo-cal.json'}]

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
        'calibrationFileId': 'cal-id',
    }

    crud_dataset.create_multicam(user, dataset_parent, data)

    item_cls.return_value.move.assert_not_called()
    item_cls.return_value.setMetadata.assert_called_once_with(
        cal_item,
        {
            constants.CalibrationFileMarker: 'true',
            constants.JsonCalibrationFileMarker: 'true',
        },
    )
    saved_meta = folder_cls.return_value.save.call_args_list[-1][0][0]['meta']
    multi_cam = saved_meta[constants.MultiCamMarker]
    assert multi_cam[constants.CalibrationItemIdMarker] == 'cal-id'
    assert multi_cam[constants.JsonCalibrationItemIdMarker] == 'cal-id'
    assert multi_cam[constants.CalibrationOriginalNameMarker] == 'stereo-cal.json'


@patch('dive_server.crud_dataset.Item')
def test_resolve_stereo_calibration_item_id_from_folder_root(item_cls):
    parent_folder = {
        '_id': 'multi-id',
        'meta': {
            constants.SubTypeMarker: 'stereo',
            constants.MultiCamMarker: {
                constants.CalibrationItemIdMarker: 'cal-id',
            },
        },
    }
    pipeline = {
        'name': 'Stereo',
        'type': constants.StereoPipelineMarker,
        'pipe': 'measurement_foo.pipe',
    }
    cal_item = {
        '_id': 'cal-id',
        'name': 'stereo-cal.json',
        'folderId': 'multi-id',
        'meta': {constants.CalibrationFileMarker: 'true'},
    }

    item_cls.return_value.findOne.return_value = cal_item

    result = crud_dataset.resolve_stereo_calibration_item_id(parent_folder, pipeline)

    assert result == 'cal-id'


@patch('dive_server.crud_dataset.Item')
def test_resolve_stereo_calibration_item_id_legacy_multi_cam_id(item_cls):
    parent_folder = {
        '_id': 'multi-id',
        'meta': {
            constants.SubTypeMarker: 'stereo',
            constants.MultiCamMarker: {constants.CalibrationItemIdMarker: 'cal-id'},
        },
    }
    pipeline = {
        'name': 'Stereo',
        'type': constants.StereoPipelineMarker,
        'pipe': 'measurement_foo.pipe',
    }
    cal_item = {
        '_id': 'cal-id',
        'name': 'stereo-cal.json',
        'folderId': 'multi-id',
        'meta': {},
    }
    item_cls.return_value.find.return_value = []
    item_cls.return_value.findOne.return_value = cal_item

    result = crud_dataset.resolve_stereo_calibration_item_id(parent_folder, pipeline)

    assert result == 'cal-id'
    item_cls.return_value.setMetadata.assert_called_once_with(
        cal_item,
        {constants.CalibrationFileMarker: 'true'},
    )


@patch('dive_server.crud_dataset.Item')
def test_resolve_stereo_calibration_item_id_skips_non_calibration_pipeline(item_cls):
    parent_folder = {
        '_id': 'multi-id',
        'meta': {constants.SubTypeMarker: 'stereo'},
    }
    pipeline = {
        'name': '2cam',
        'type': '2-cam',
        'pipe': '2-cam_foo.pipe',
        'metadata': {'requiresCalibration': False},
    }

    assert crud_dataset.resolve_stereo_calibration_item_id(parent_folder, pipeline) is None
    item_cls.return_value.find.assert_not_called()
