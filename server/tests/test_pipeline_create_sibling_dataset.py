from pathlib import Path
from unittest.mock import MagicMock

from dive_tasks.utils import create_sibling_dataset_from_media
from dive_utils import constants


def test_create_sibling_dataset_defaults_to_input_parent(tmp_path: Path):
    media = tmp_path / 'out'
    media.mkdir()
    (media / 'frame0001.png').write_bytes(b'png')

    gc = MagicMock()
    gc.getFolder.return_value = {'_id': 'input-id', 'parentId': 'sibling-parent'}
    gc.createFolder.return_value = {'_id': 'new-id'}
    manager = MagicMock()

    new_id = create_sibling_dataset_from_media(
        gc,
        manager,
        'input-id',
        media,
        'filter_out',
        constants.ImageSequenceType,
        5,
    )

    assert new_id == 'new-id'
    gc.createFolder.assert_called_once_with('sibling-parent', 'filter_out', reuseExisting=False)
    gc.uploadFileToFolder.assert_called_once()
    gc.addMetadataToFolder.assert_called_once()
    gc.sendRestRequest.assert_called_once_with('POST', '/dive_rpc/postprocess/new-id')


def test_create_sibling_dataset_uses_explicit_parent_folder(tmp_path: Path):
    media = tmp_path / 'out'
    media.mkdir()
    (media / 'clip.mp4').write_bytes(b'mp4')

    gc = MagicMock()
    gc.getFolder.return_value = {'_id': 'input-id', 'parentId': 'sibling-parent'}
    gc.createFolder.return_value = {'_id': 'new-id'}
    manager = MagicMock()

    create_sibling_dataset_from_media(
        gc,
        manager,
        'input-id',
        media,
        'transcode_out',
        constants.VideoType,
        30,
        parent_folder_id='chosen-parent',
    )

    gc.createFolder.assert_called_once_with('chosen-parent', 'transcode_out', reuseExisting=False)
    meta = gc.addMetadataToFolder.call_args[0][1]
    assert meta[constants.TypeMarker] == constants.VideoType
    assert meta[constants.FPSMarker] == 30
