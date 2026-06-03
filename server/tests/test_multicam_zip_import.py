import json
from pathlib import Path
import sys
from unittest.mock import MagicMock, call

import pytest

# dive_tasks package __init__ imports girder_worker; stub it for unit tests.
if 'girder_worker' not in sys.modules:
    _gw = MagicMock()
    sys.modules['girder_worker'] = _gw
    sys.modules['girder_worker.task'] = _gw.task
    sys.modules['girder_worker.utils'] = _gw.utils

from dive_tasks import utils  # noqa: E402
from dive_utils import constants


def _write_image_sequence_export(target: Path, images: list[str], fps: float = 5.0):
    target.mkdir(parents=True, exist_ok=True)
    (target / 'frame0.png').write_bytes(b'png')
    meta = {
        'type': constants.ImageSequenceType,
        'fps': fps,
        'version': 1,
        'imageData': [{'filename': name} for name in images],
    }
    (target / 'meta.json').write_text(json.dumps(meta))


def _write_multicam_export_tree(
    root: Path, *, sub_type: str = 'stereo', with_calibration: bool = True
):
    _write_image_sequence_export(root / 'left', ['frame0.png'])
    _write_image_sequence_export(root / 'right', ['frame0.png'])
    multi_cam = {
        'defaultDisplay': 'left',
        'cameraOrder': ['left', 'right'],
        'cameras': {
            'left': {'folderId': 'old-left', 'type': constants.ImageSequenceType},
            'right': {'folderId': 'old-right', 'type': constants.ImageSequenceType},
        },
    }
    (root / constants.MultiCamJsonFileName).write_text(json.dumps(multi_cam))
    parent_meta = {
        'type': constants.MultiType,
        'subType': sub_type,
        'fps': 5.0,
        'version': 1,
        'name': 'stereo-import',
    }
    (root / 'meta.json').write_text(json.dumps(parent_meta))
    if with_calibration and sub_type == 'stereo':
        (root / 'calibration.npz').write_bytes(b'npz')


@pytest.fixture
def mock_gc():
    gc = MagicMock()
    gc.getFolder.return_value = {'_id': 'parent-id', 'name': 'stereo-import'}
    gc.createFolder.side_effect = lambda parent_id, name, **kwargs: {
        '_id': f'{name}-id',
        'name': name,
    }
    gc.listItem.return_value = [{'_id': 'cal-item-id', 'name': 'calibration.npz'}]
    return gc


@pytest.fixture
def mock_manager():
    return MagicMock()


def test_is_path_under_multicam_export_includes_camera_subfolders():
    roots = {'left_and_right_folder'}
    assert utils.is_path_under_multicam_export('left_and_right_folder', roots)
    assert utils.is_path_under_multicam_export('left_and_right_folder/left', roots)
    assert utils.is_path_under_multicam_export('left_and_right_folder/left/frame0.png', roots)
    assert not utils.is_path_under_multicam_export('other_dataset/left', roots)


def test_multicam_camera_order_respects_camera_order():
    multi_cam = {
        'cameras': {'b': {}, 'a': {}, 'c': {}},
        'cameraOrder': ['c', 'a', 'b'],
    }
    assert utils._multicam_camera_order(multi_cam) == ['c', 'a', 'b']


def test_import_exported_dataset_rejects_multicam_root(tmp_path, mock_gc, mock_manager):
    root = tmp_path / 'multi'
    _write_multicam_export_tree(root)
    with pytest.raises(
        ValueError, match='multicamera; use multicam zip import instead of single-dataset import'
    ):
        utils._import_exported_dataset_directory(mock_gc, mock_manager, 'dest', root)


def test_upload_exported_multicam_imports_cameras_and_finalizes(tmp_path, mock_gc, mock_manager):
    root = tmp_path / 'stereo-dataset'
    _write_multicam_export_tree(root)

    utils.upload_exported_multicam_zipped_dataset(mock_gc, mock_manager, 'parent-id', root, '')

    assert mock_gc.createFolder.call_args_list == [
        call('parent-id', 'left', reuseExisting=True),
        call('parent-id', 'right', reuseExisting=True),
    ]
    assert mock_gc.upload.call_count >= 3
    mock_gc.sendRestRequest.assert_called_once()
    (_method, path), kwargs = mock_gc.sendRestRequest.call_args
    assert _method == 'POST'
    assert path == '/dive_dataset/multicam'
    assert kwargs['parameters'] == {'parentFolderId': 'parent-id'}
    body = kwargs['json']
    assert body['subType'] == 'stereo'
    assert body['defaultDisplay'] == 'left'
    assert body['cameras'] == {
        'left': {'folderId': 'left-id'},
        'right': {'folderId': 'right-id'},
    }
    assert body['calibrationFileId'] == 'cal-item-id'


def test_upload_exported_zipped_dataset_redirects_when_multicam_json_present(
    tmp_path,
    mock_gc,
    mock_manager,
    monkeypatch,
):
    root = tmp_path / 'stereo-dataset'
    _write_multicam_export_tree(root)
    multicam_mock = MagicMock()
    monkeypatch.setattr(utils, 'upload_exported_multicam_zipped_dataset', multicam_mock)

    utils.upload_exported_zipped_dataset(mock_gc, mock_manager, 'parent-id', root, '')

    multicam_mock.assert_called_once_with(mock_gc, mock_manager, 'parent-id', root, '')
