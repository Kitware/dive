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


def _write_image_sequence_export(
    target: Path,
    images: list[str],
    fps: float = 5.0,
    metadata_name: str | None = None,
    extra_meta: dict | None = None,
):
    """Write an exported image-sequence dataset directory.

    The archive declares its attachment by directory alone, so meta.json carries no
    locator: the attachment is whatever single file sits in ``metadata/``.
    """
    target.mkdir(parents=True, exist_ok=True)
    (target / 'frame0.png').write_bytes(b'png')
    meta = {
        'type': constants.ImageSequenceType,
        'fps': fps,
        'version': 1,
        'imageData': [{'filename': name} for name in images],
        **(extra_meta or {}),
    }
    if metadata_name:
        metadata_dir = target / 'metadata'
        metadata_dir.mkdir()
        (metadata_dir / metadata_name).write_text('filename,depth\nframe0.png,10\n')
    (target / 'meta.json').write_text(json.dumps(meta))


def _write_multicam_export_tree(
    root: Path,
    *,
    sub_type: str = 'stereo',
    with_calibration: bool = True,
    with_metadata: bool = False,
):
    _write_image_sequence_export(
        root / 'left',
        ['frame0.png'],
        metadata_name='left.csv' if with_metadata else None,
    )
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
    if with_metadata:
        metadata_dir = root / 'metadata'
        metadata_dir.mkdir()
        (metadata_dir / 'shared.csv').write_text('filename,depth\nframe0.png,20\n')
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


def _list_items_by_name(folder_id, name=None):
    """Resolve an uploaded item the way girder does, with an id derived from its folder."""
    if name:
        return [{'_id': f'{folder_id}-{name}', 'name': name}]
    return []


def test_import_exported_dataset_uploads_and_links_the_metadata_directory_attachment(
    tmp_path,
    mock_gc,
    mock_manager,
):
    root = tmp_path / 'dataset'
    _write_image_sequence_export(root, ['frame0.png'], metadata_name='nav.csv')
    mock_gc.listItem.side_effect = _list_items_by_name

    utils._import_exported_dataset_directory(mock_gc, mock_manager, 'dest', root)

    uploaded = [call_args.args[0] for call_args in mock_gc.upload.call_args_list]
    assert str(root / 'metadata' / 'nav.csv') in uploaded
    assert str(root / 'metadata') not in uploaded
    folder_meta = mock_gc.addMetadataToFolder.call_args.args[1]
    assert folder_meta[constants.MetadataFileItemIdMarker] == 'dest-nav.csv'
    assert folder_meta[constants.MetadataFileOriginalNameMarker] == 'nav.csv'


def test_import_exported_dataset_ignores_a_legacy_item_id_in_meta_json(
    tmp_path,
    mock_gc,
    mock_manager,
):
    """Archives from today's upstream carry a bare item id and no metadata/ directory."""
    root = tmp_path / 'dataset'
    _write_image_sequence_export(
        root,
        ['frame0.png'],
        extra_meta={
            constants.MetadataFileItemIdMarker: '65a140e8a4c218785d408b42',
            constants.MetadataFileOriginalNameMarker: 'nav.csv',
        },
    )
    (root / 'nav.csv').write_text('filename,depth\nframe0.png,10\n')
    mock_gc.listItem.side_effect = _list_items_by_name

    utils._import_exported_dataset_directory(mock_gc, mock_manager, 'dest', root)

    uploaded = [call_args.args[0] for call_args in mock_gc.upload.call_args_list]
    assert str(root / 'nav.csv') in uploaded
    folder_meta = mock_gc.addMetadataToFolder.call_args.args[1]
    assert constants.MetadataFileItemIdMarker not in folder_meta
    assert constants.MetadataFileOriginalNameMarker not in folder_meta


def test_import_exported_dataset_finds_a_nested_metadata_directory_attachment(
    tmp_path,
    mock_gc,
    mock_manager,
):
    """Discovery walks metadata/ recursively, matching desktop's archiveMetadataAttachment."""
    root = tmp_path / 'dataset'
    _write_image_sequence_export(root, ['frame0.png'])
    nested = root / 'metadata' / 'sub'
    nested.mkdir(parents=True)
    (nested / 'nav.csv').write_text('filename,depth\nframe0.png,10\n')
    mock_gc.listItem.side_effect = _list_items_by_name

    utils._import_exported_dataset_directory(mock_gc, mock_manager, 'dest', root)

    uploaded = [call_args.args[0] for call_args in mock_gc.upload.call_args_list]
    assert str(nested / 'nav.csv') in uploaded
    folder_meta = mock_gc.addMetadataToFolder.call_args.args[1]
    assert folder_meta[constants.MetadataFileItemIdMarker] == 'dest-nav.csv'
    assert folder_meta[constants.MetadataFileOriginalNameMarker] == 'nav.csv'


@pytest.mark.parametrize('second_attachment', ['extra.csv', 'sub/extra.csv'])
def test_import_exported_dataset_rejects_more_than_one_metadata_file(
    tmp_path,
    mock_gc,
    mock_manager,
    second_attachment,
):
    """Ambiguity counts across the whole metadata/ tree, flat or nested, as desktop does."""
    root = tmp_path / 'dataset'
    _write_image_sequence_export(root, ['frame0.png'], metadata_name='nav.csv')
    extra = root / 'metadata' / second_attachment
    extra.parent.mkdir(parents=True, exist_ok=True)
    extra.write_text('filename,depth\nframe0.png,30\n')

    with pytest.raises(ValueError, match='More than one metadata file was found'):
        utils._import_exported_dataset_directory(mock_gc, mock_manager, 'dest', root)

    mock_gc.upload.assert_not_called()


def test_import_exported_dataset_rejects_an_unreadable_metadata_extension(
    tmp_path,
    mock_gc,
    mock_manager,
):
    root = tmp_path / 'dataset'
    _write_image_sequence_export(root, ['frame0.png'], metadata_name='notes.md')

    with pytest.raises(ValueError, match='must be a JSON, TXT, or CSV file'):
        utils._import_exported_dataset_directory(mock_gc, mock_manager, 'dest', root)

    mock_gc.upload.assert_not_called()


def test_upload_exported_multicam_ignores_a_legacy_item_id_in_meta_json(
    tmp_path,
    mock_gc,
    mock_manager,
):
    """A multicam zip from today's upstream declares a bare item id and writes the attachment
    at the archive root instead of in metadata/.

    The import must not fail on the legacy key, and the root-level file is dropped: the
    multicam path only uploads the calibration file and the discovered metadata/ attachment
    from the parent directory. Pinned so the loss is a known cost of discovery-by-directory
    rather than an accident.
    """
    root = tmp_path / 'multicam-dataset'
    _write_multicam_export_tree(root, sub_type='multicam', with_calibration=False)
    parent_meta = json.loads((root / 'meta.json').read_text())
    parent_meta[constants.MetadataFileItemIdMarker] = '65a140e8a4c218785d408b42'
    (root / 'meta.json').write_text(json.dumps(parent_meta))
    (root / 'shared.csv').write_text('filename,depth\nframe0.png,20\n')

    utils.upload_exported_multicam_zipped_dataset(mock_gc, mock_manager, 'parent-id', root, '')

    (_, _), kwargs = mock_gc.sendRestRequest.call_args
    assert 'metadataFileId' not in kwargs['json']
    uploaded = [call_args.args[0] for call_args in mock_gc.upload.call_args_list]
    assert str(root / 'shared.csv') not in uploaded


def test_upload_exported_multicam_rejects_multiple_attachments_before_mutation(
    tmp_path,
    mock_gc,
    mock_manager,
):
    root = tmp_path / 'multicam-dataset'
    _write_multicam_export_tree(
        root,
        sub_type='multicam',
        with_calibration=False,
        with_metadata=True,
    )
    (root / 'metadata' / 'extra.csv').write_text('filename,depth\nframe0.png,30\n')

    with pytest.raises(ValueError, match='More than one metadata file was found'):
        utils.upload_exported_multicam_zipped_dataset(mock_gc, mock_manager, 'parent-id', root, '')

    mock_gc.createFolder.assert_not_called()
    mock_gc.upload.assert_not_called()


def test_upload_exported_multicam_restores_shared_and_camera_metadata(
    tmp_path,
    mock_gc,
    mock_manager,
):
    root = tmp_path / 'multicam-dataset'
    _write_multicam_export_tree(
        root,
        sub_type='multicam',
        with_calibration=False,
        with_metadata=True,
    )
    mock_gc.listItem.side_effect = _list_items_by_name

    utils.upload_exported_multicam_zipped_dataset(mock_gc, mock_manager, 'parent-id', root, '')

    (_, _), kwargs = mock_gc.sendRestRequest.call_args
    assert kwargs['json']['metadataFileId'] == 'parent-id-shared.csv'
    left_meta = next(
        call_args.args[1]
        for call_args in mock_gc.addMetadataToFolder.call_args_list
        if call_args.args[0] == 'left-id'
    )
    assert left_meta[constants.MetadataFileItemIdMarker] == 'left-id-left.csv'
    assert left_meta[constants.MetadataFileOriginalNameMarker] == 'left.csv'
    right_meta = next(
        call_args.args[1]
        for call_args in mock_gc.addMetadataToFolder.call_args_list
        if call_args.args[0] == 'right-id'
    )
    assert constants.MetadataFileItemIdMarker not in right_meta
