from unittest.mock import patch

import pytest

from dive_server.crud_rpc import run_pipeline
from dive_utils import constants

USER = {'_id': 'user-id', 'login': 'someone'}
DETECTOR_PIPELINE = {
    'name': 'stabilizer',
    'type': 'detector',
    'pipe': 'detector_stabilizer.pipe',
    'folderId': None,
    'metadata': {'metadataFileKey': 'stabilizer:flight_log'},
}
MULTICAM_PIPELINE = {
    'name': 'stereo stabilizer',
    'type': '2-cam',
    'pipe': 'detector_stereo.pipe',
    'folderId': None,
    'metadata': {'metadataFileKey': 'stabilizer:flight_log'},
}


def _image_sequence_folder(folder_id='ds'):
    return {
        '_id': folder_id,
        'name': folder_id,
        'meta': {'type': constants.ImageSequenceType, 'fps': 5},
    }


def _multicam_folder(camera_folder_ids):
    return {
        '_id': 'parent',
        'name': 'parent',
        'meta': {
            'type': constants.MultiType,
            'fps': 5,
            constants.MultiCamMarker: {
                'defaultDisplay': 'left',
                'cameras': {
                    name: {'folderId': folder_id, 'type': constants.ImageSequenceType}
                    for name, folder_id in camera_folder_ids.items()
                },
            },
        },
    }


@pytest.fixture
def pipeline_run_env():
    """Patch everything run_pipeline touches except the metadata attachment resolution."""
    with (
        patch('dive_server.crud_rpc.verify_pipe'),
        patch('dive_server.crud_rpc.crud.getCloneRoot'),
        patch('dive_server.crud_rpc.crud.get_multicam_parent_folder') as multicam_parent,
        patch('dive_server.crud_rpc.crud.get_multicam_camera_name') as camera_name,
        patch('dive_server.crud_rpc.crud_dataset.resolve_stereo_calibration_item_id') as cal_id,
        patch('dive_server.crud_rpc.crud_dataset.pipeline_requires_calibration') as needs_cal,
        patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id') as resolve,
        patch('dive_server.crud_rpc.Folder') as folder_cls,
        patch('dive_server.crud_rpc.Job') as job_cls,
        patch('dive_server.crud_rpc.Token'),
        patch('dive_server.crud_rpc.Notification'),
        patch('dive_server.crud_rpc.tasks') as tasks_module,
        patch('dive_server.crud_rpc._persist_async_job_metadata') as persist_job,
    ):
        multicam_parent.return_value = None
        camera_name.return_value = None
        cal_id.return_value = None
        needs_cal.return_value = False
        job_cls.return_value.findOne.return_value = None  # no outstanding job
        persist_job.return_value = {'_id': 'job-id'}
        yield {
            'resolve': resolve,
            'multicam_parent': multicam_parent,
            'camera_name': camera_name,
            'folder_cls': folder_cls,
            'job_cls': job_cls,
            'tasks': tasks_module,
        }


def _job_params(env):
    return env['tasks'].run_pipeline.apply_async.call_args.kwargs['kwargs']['params']


def test_single_dataset_run_binds_its_own_attachment(pipeline_run_env):
    folder = _image_sequence_folder()
    pipeline_run_env['resolve'].return_value = 'nav-item'

    run_pipeline(USER, folder, DETECTOR_PIPELINE)

    params = _job_params(pipeline_run_env)
    assert params['metadata_file_key'] == 'stabilizer:flight_log'
    assert params['metadata_file_item_id'] == 'nav-item'
    pipeline_run_env['resolve'].assert_called_once_with(folder, USER)


def test_camera_run_falls_back_to_the_shared_parent_attachment(pipeline_run_env):
    # A single-camera run on a camera folder must still see the attachment the parent owns:
    # the panel shows it for that camera, so the pipeline gets the same file.
    camera = _image_sequence_folder('left')
    parent = _multicam_folder({'left': 'left', 'right': 'right'})
    pipeline_run_env['multicam_parent'].return_value = parent
    pipeline_run_env['camera_name'].return_value = 'left'
    pipeline_run_env['resolve'].side_effect = lambda scope, user: (
        'shared-item' if scope is parent else None
    )

    run_pipeline(USER, camera, DETECTOR_PIPELINE)

    assert _job_params(pipeline_run_env)['metadata_file_item_id'] == 'shared-item'
    # Camera-local first, shared parent second.
    assert [call.args[0] for call in pipeline_run_env['resolve'].call_args_list] == [
        camera,
        parent,
    ]


def test_camera_run_prefers_its_own_camera_attachment(pipeline_run_env):
    camera = _image_sequence_folder('left')
    parent = _multicam_folder({'left': 'left', 'right': 'right'})
    pipeline_run_env['multicam_parent'].return_value = parent
    pipeline_run_env['camera_name'].return_value = 'left'
    pipeline_run_env['resolve'].side_effect = lambda scope, user: (
        'camera-item' if scope is camera else 'shared-item'
    )

    run_pipeline(USER, camera, DETECTOR_PIPELINE)

    assert _job_params(pipeline_run_env)['metadata_file_item_id'] == 'camera-item'


def test_multicam_run_falls_back_to_the_default_display_camera_attachment(pipeline_run_env):
    # A stereo/multicam run reads the shared attachment first, but a dataset whose only
    # attachment sits on the default display camera must not run without it.
    parent = _multicam_folder({'left': 'left-id', 'right': 'right-id'})
    camera_folders = {
        'left-id': _image_sequence_folder('left-id'),
        'right-id': _image_sequence_folder('right-id'),
    }
    pipeline_run_env['folder_cls'].return_value.load.side_effect = (
        lambda folder_id, level=None, user=None: camera_folders[folder_id]
    )
    pipeline_run_env['resolve'].side_effect = lambda scope, user: (
        'camera-item' if scope is camera_folders['left-id'] else None
    )

    run_pipeline(USER, parent, MULTICAM_PIPELINE)

    assert _job_params(pipeline_run_env)['metadata_file_item_id'] == 'camera-item'
    assert [call.args[0] for call in pipeline_run_env['resolve'].call_args_list] == [
        parent,
        camera_folders['left-id'],
    ]


def test_declared_key_without_an_attachment_is_reported_in_the_job_log(pipeline_run_env):
    # The setting is dropped, so say so in the job log the way the missing-calibration
    # notice does, instead of running silently without it.
    folder = _image_sequence_folder()
    pipeline_run_env['resolve'].return_value = None

    run_pipeline(USER, folder, DETECTOR_PIPELINE)

    params = _job_params(pipeline_run_env)
    assert 'metadata_file_item_id' not in params
    assert 'metadata_file_key' not in params
    log = pipeline_run_env['job_cls'].return_value.updateJob.call_args.kwargs['log']
    assert 'stabilizer:flight_log' in log
    assert 'no metadata attachment' in log


def test_pipeline_without_a_metadata_key_resolves_nothing(pipeline_run_env):
    folder = _image_sequence_folder()
    pipeline = {**DETECTOR_PIPELINE, 'metadata': {}}

    run_pipeline(USER, folder, pipeline)

    assert 'metadata_file_key' not in _job_params(pipeline_run_env)
    pipeline_run_env['resolve'].assert_not_called()
    pipeline_run_env['job_cls'].return_value.updateJob.assert_not_called()
