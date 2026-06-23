from unittest.mock import MagicMock, patch

from girder.exceptions import RestException
import pytest

from dive_server import crud_rpc
from dive_utils import constants


def _multicam_folder(sub_type: str):
    """A multicamera parent folder doc with two cameras."""
    return {
        '_id': 'multi-id',
        'name': 'multicam-set',
        'meta': {
            constants.TypeMarker: constants.MultiType,
            constants.SubTypeMarker: sub_type,
            constants.MultiCamMarker: {
                'defaultDisplay': 'left',
                'cameraOrder': ['left', 'right'],
                'cameras': {
                    'left': {'folderId': 'left-id', 'type': constants.ImageSequenceType},
                    'right': {'folderId': 'right-id', 'type': constants.ImageSequenceType},
                },
            },
        },
    }


def _child_folder(folder_id: str):
    return {
        '_id': folder_id,
        'name': folder_id,
        'meta': {constants.TypeMarker: constants.ImageSequenceType},
    }


def _patched_run_pipeline(test_fn):
    """Stack the mocks needed to exercise the calibration gate in run_pipeline."""
    decorators = [
        patch('dive_server.crud_rpc.verify_pipe'),
        patch('dive_server.crud_rpc.crud.getCloneRoot'),
        patch('dive_server.crud_rpc._check_running_jobs', return_value=False),
        patch('dive_server.crud_rpc.Token'),
        patch('dive_server.crud_rpc.Folder'),
        patch('dive_server.crud_rpc.crud_dataset'),
        patch('dive_server.crud_rpc.tasks'),
        patch('dive_server.crud_rpc._persist_async_job_metadata'),
        patch('dive_server.crud_rpc.Notification'),
    ]
    for decorator in decorators:
        test_fn = decorator(test_fn)
    return test_fn


def _configure_mocks(folder_cls, crud_dataset_mock, persist_mock, token_cls, calibration_id):
    folder_cls.return_value.load.side_effect = lambda fid, **kwargs: _child_folder(fid)
    token_cls.return_value.createToken.return_value = {'_id': 'tok'}
    # Pure helper; reuse the real implementation reading the multiCam dict.
    crud_dataset_mock._multicam_camera_order.side_effect = lambda mc: mc['cameraOrder']
    crud_dataset_mock.resolve_calibration_item_id.return_value = calibration_id
    persist_mock.return_value = {'_id': 'job'}


@_patched_run_pipeline
def test_run_pipeline_multicam_without_calibration_proceeds(
    _verify_pipe,
    _clone_root,
    _check_jobs,
    token_cls,
    folder_cls,
    crud_dataset_mock,
    tasks_mock,
    persist_mock,
    notification_cls,
):
    """A multicam pipeline with no calibration enqueues the job (calibration optional)."""
    _configure_mocks(folder_cls, crud_dataset_mock, persist_mock, token_cls, calibration_id=None)
    user = {'_id': 'u1', 'login': 'tester'}
    folder = _multicam_folder('multicam')
    pipeline = {'name': '2cam', 'type': '2-cam', 'pipe': '2-cam_foo.pipe'}

    job = crud_rpc.run_pipeline(user, folder, pipeline)

    assert job == {'_id': 'job'}
    tasks_mock.run_pipeline.apply_async.assert_called_once()


@_patched_run_pipeline
def test_run_pipeline_stereo_measurement_without_calibration_raises(
    _verify_pipe,
    _clone_root,
    _check_jobs,
    token_cls,
    folder_cls,
    crud_dataset_mock,
    tasks_mock,
    persist_mock,
    notification_cls,
):
    """Stereo measurement still requires calibration: 404 when absent."""
    _configure_mocks(folder_cls, crud_dataset_mock, persist_mock, token_cls, calibration_id=None)
    user = {'_id': 'u1', 'login': 'tester'}
    folder = _multicam_folder('stereo')
    pipeline = {'name': 'Stereo', 'type': constants.StereoPipelineMarker, 'pipe': 'stereo.pipe'}

    with pytest.raises(RestException, match='calibration'):
        crud_rpc.run_pipeline(user, folder, pipeline)

    tasks_mock.run_pipeline.apply_async.assert_not_called()


@_patched_run_pipeline
def test_run_pipeline_stereo_measurement_with_calibration_proceeds(
    _verify_pipe,
    _clone_root,
    _check_jobs,
    token_cls,
    folder_cls,
    crud_dataset_mock,
    tasks_mock,
    persist_mock,
    notification_cls,
):
    """Stereo measurement enqueues and forwards the resolved calibration id."""
    _configure_mocks(folder_cls, crud_dataset_mock, persist_mock, token_cls, calibration_id='cal-id')
    user = {'_id': 'u1', 'login': 'tester'}
    folder = _multicam_folder('stereo')
    pipeline = {'name': 'Stereo', 'type': constants.StereoPipelineMarker, 'pipe': 'stereo.pipe'}

    crud_rpc.run_pipeline(user, folder, pipeline)

    tasks_mock.run_pipeline.apply_async.assert_called_once()
    enqueued_params = tasks_mock.run_pipeline.apply_async.call_args.kwargs['kwargs']['params']
    assert enqueued_params['calibration_item_id'] == 'cal-id'
