"""Stitched stereo media is split into one half per camera folder."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from dive_tasks.split_stitched import stitched_crop_filter
from dive_utils import constants

PROBE = {
    'streams': [
        {
            'codec_type': 'video',
            'codec_name': 'h264',
            'avg_frame_rate': '30/1',
            'r_frame_rate': '30/1',
        }
    ],
    'format': {'format_name': 'mov,mp4,m4a,3gp,3g2,mj2'},
}


def _run_split(items, side):
    from dive_tasks.split_stitched import split_stitched_media

    task = MagicMock()
    task.canceled = False
    gc = MagicMock()
    gc.listItem.return_value = iter(items)
    gc.uploadFileToFolder.return_value = {'itemId': 'new-item'}
    task.girder_client = gc
    task.job_manager = MagicMock()
    commands = []

    def fake_subprocess(_task, _context, _manager, popen_kwargs, **_kwargs):
        commands.append(popen_kwargs['args'])
        Path(popen_kwargs['args'][-1]).write_text('half')
        return ''

    def fake_download(_item_id, directory, name=None):
        (Path(directory) / name).write_text('stitched')

    gc.downloadItem.side_effect = fake_download
    with (
        patch('dive_tasks.split_stitched.patch_manager', return_value=MagicMock()),
        patch('dive_tasks.split_stitched.utils.check_canceled', return_value=False),
        patch('dive_tasks.split_stitched.utils.ffprobe_format_and_streams', return_value=PROBE),
        patch('dive_tasks.split_stitched.utils.stream_subprocess', side_effect=fake_subprocess),
        patch(
            'dive_tasks.split_stitched.check_and_fix_frame_alignment',
            side_effect=lambda _task, path, _context, _manager: path,
        ),
        patch('dive_tasks.split_stitched.resolve_annotation_fps', return_value=30.0),
    ):
        # PromiseProxy.__wrapped__ is a bound method; call the unbound function.
        split_stitched_media.__wrapped__.__func__(
            task, folderId='folder1', side=side, user_id='user1', user_login='alice'
        )
    return gc, commands


def test_crop_filters_keep_equal_halves():
    assert stitched_crop_filter('left') == 'crop=trunc(iw/2):ih:0:0'
    assert stitched_crop_filter('right') == 'crop=trunc(iw/2):ih:iw-trunc(iw/2):0'
    with pytest.raises(ValueError):
        stitched_crop_filter('center')


def test_split_images_replaces_each_image_with_its_half():
    items = [
        {'_id': 'i1', 'name': 'frame0.jpg'},
        {'_id': 'i2', 'name': 'frame1.bmp'},
        {'_id': 'i3', 'name': 'tracks.csv'},
    ]
    gc, commands = _run_split(items, 'right')

    assert len(commands) == 2
    for command in commands:
        assert stitched_crop_filter('right') in command
    uploaded = [Path(call.args[1]).name for call in gc.uploadFileToFolder.call_args_list]
    # Web-safe names are kept; other formats become PNG.
    assert uploaded == ['frame0.jpg', 'frame1.png']
    deleted = [call.args[0] for call in gc.delete.call_args_list]
    assert deleted == ['item/i1', 'item/i2']
    folder_meta = gc.addMetadataToFolder.call_args[0][1]
    assert folder_meta[constants.DatasetMarker] is True


def test_split_video_uploads_cropped_transcode_and_removes_source():
    gc, commands = _run_split([{'_id': 'v1', 'name': 'pairs.avi'}], 'left')

    assert len(commands) == 1
    video_filter = commands[0][commands[0].index('-vf') + 1]
    assert video_filter.startswith(stitched_crop_filter('left') + ',')
    assert Path(gc.uploadFileToFolder.call_args[0][1]).name == 'pairs.transcoded.mp4'
    item_meta = gc.addMetadataToItem.call_args[0][1]
    assert item_meta['codec'] == 'h264'
    assert item_meta['source_video'] is False
    gc.delete.assert_called_once_with('item/v1')
    folder_meta = gc.addMetadataToFolder.call_args[0][1]
    assert folder_meta[constants.DatasetMarker] is True
    assert folder_meta[constants.FPSMarker] == 30.0
