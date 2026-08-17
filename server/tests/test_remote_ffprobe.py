"""Tests for remote ffprobe helpers used by convert_video."""

import os
from unittest.mock import MagicMock, patch

import pytest

from dive_tasks import utils
from dive_tasks.frame_alignment import is_frame_misaligned
from dive_tasks.utils import CanceledError


class _FakeGirderClient:
    def __init__(self, url_base='http://girder.example/api/v1/', token='tok-123'):
        self.urlBase = url_base
        self.token = token


def test_girder_auth_headers_use_crlf():
    assert utils.girder_auth_headers('abc') == 'Girder-Token: abc\r\n'


def test_file_download_url_joins_api_base():
    gc = _FakeGirderClient()
    assert utils.file_download_url(gc, 'file99') == (
        'http://girder.example/api/v1/file/file99/download'
    )


def test_item_primary_file_download_url_uses_file_endpoint():
    gc = MagicMock()
    gc.urlBase = 'http://girder.example/api/v1/'
    gc.listFile.return_value = iter([{'_id': 'file42', 'name': 'clip.mp4'}])
    assert utils.item_primary_file_download_url(gc, 'item99') == (
        'http://girder.example/api/v1/file/file42/download'
    )
    gc.listFile.assert_called_once_with('item99', limit=2)


def test_item_primary_file_download_url_requires_a_file():
    gc = MagicMock()
    gc.urlBase = 'http://girder.example/api/v1/'
    gc.listFile.return_value = iter([])
    with pytest.raises(Exception, match='no files'):
        utils.item_primary_file_download_url(gc, 'item99')


def test_format_byte_count():
    assert utils.format_byte_count(512) == '512 B'
    assert utils.format_byte_count(2048) == '2.00 KiB'
    assert utils.format_byte_count(5 * 1024 * 1024) == '5.00 MiB'


def test_parse_ffmpeg_http_bytes_read_sums_statistics_lines():
    stderr = (
        '[http @ 0x1] Opening...\n'
        '[http @ 0x1] Statistics: 12345 bytes read, 2 seeks\n'
        '[http @ 0x2] Statistics: 1000 bytes read, 0 seeks\n'
    )
    assert utils.parse_ffmpeg_http_bytes_read(stderr) == 13345
    assert utils.parse_ffmpeg_http_bytes_read('no stats here') is None


def test_sanitize_subprocess_args_redacts_inline_headers():
    args = [
        'ffprobe',
        '-headers',
        'Girder-Token: secret-tok\r\n',
        '-show_format',
        'http://example/item/1/download',
    ]
    sanitized = utils.sanitize_subprocess_args_for_log(args)
    assert sanitized[sanitized.index('-headers') + 1] == '<redacted>'
    assert 'secret-tok' not in str(sanitized)
    # Original untouched
    assert args[2] == 'Girder-Token: secret-tok\r\n'


def test_sanitize_subprocess_args_keeps_header_file_path():
    args = ['ffprobe', '-/headers', '/tmp/ffprobe-headers-xyz.txt', 'http://example/x']
    assert utils.sanitize_subprocess_args_for_log(args) == args


def test_sanitize_subprocess_args_keeps_shell_command_string():
    cmd = (
        '. /opt/noaa/viame/setup_viame.sh && KWIVER_DEFAULT_LOG_LEVEL=warn '
        '/opt/noaa/viame/bin/viame train --no-query --no-embedded-pipe'
    )
    assert utils.sanitize_subprocess_args_for_log(cmd) == cmd


def test_ffprobe_header_args_uses_file_when_supported():
    headers = 'Girder-Token: tok\r\n'
    with patch.object(utils, 'ffprobe_supports_option_from_file', return_value=True):
        with utils.ffprobe_header_args(headers) as header_args:
            assert header_args[0] == '-/headers'
            path = header_args[1]
            assert os.path.isfile(path)
            with open(path, encoding='utf-8', newline='') as f:
                assert f.read() == headers
        assert not os.path.exists(path)


def test_ffprobe_header_args_falls_back_to_inline_headers():
    headers = 'Girder-Token: tok\r\n'
    with patch.object(utils, 'ffprobe_supports_option_from_file', return_value=False):
        with utils.ffprobe_header_args(headers) as header_args:
            assert header_args == ['-headers', headers]


@pytest.mark.parametrize(
    'kwargs,expected',
    [
        (
            {
                'skip_transcoding': True,
                'codec_name': 'h264',
                'sample_aspect_ratio': '1:1',
                'format_name': 'mov,mp4,m4a,3gp,3g2,mj2',
                'source_misaligned': False,
            },
            True,
        ),
        (
            {
                'skip_transcoding': False,
                'codec_name': 'h264',
                'sample_aspect_ratio': '1:1',
                'format_name': 'mp4',
                'source_misaligned': False,
            },
            False,
        ),
        (
            {
                'skip_transcoding': True,
                'codec_name': 'hevc',
                'sample_aspect_ratio': '1:1',
                'format_name': 'mp4',
                'source_misaligned': False,
            },
            False,
        ),
        (
            {
                'skip_transcoding': True,
                'codec_name': 'h264',
                'sample_aspect_ratio': '1:1',
                'format_name': 'mpegts',
                'source_misaligned': False,
            },
            False,
        ),
        (
            {
                'skip_transcoding': True,
                'codec_name': 'h264',
                'sample_aspect_ratio': '1:1',
                'format_name': 'mp4',
                'source_misaligned': True,
            },
            False,
        ),
    ],
)
def test_can_skip_video_transcoding(kwargs, expected):
    assert utils.can_skip_video_transcoding(**kwargs) is expected


def test_ffprobe_format_and_streams_passes_headers_via_file():
    task = MagicMock()
    manager = MagicMock()
    probe_json = '{"streams":[],"format":{}}'
    stderr = '[http @ 0x1] Statistics: 4096 bytes read, 1 seeks\n'

    with (
        patch.object(utils, 'ffprobe_supports_option_from_file', return_value=True),
        patch.object(utils, 'stream_subprocess', return_value=(probe_json, stderr)) as mock_run,
    ):
        result = utils.ffprobe_format_and_streams(
            task,
            {},
            manager,
            'http://girder.example/api/v1/file/1/download',
            headers='Girder-Token: tok\r\n',
        )

    assert result == {'streams': [], 'format': {}}
    command = mock_run.call_args[0][3]['args']
    assert command[0] == 'ffprobe'
    assert '-/headers' in command
    assert '-headers' not in command
    header_idx = command.index('-/headers')
    assert 'tok' not in command[header_idx + 1]
    assert command[-1] == 'http://girder.example/api/v1/file/1/download'
    assert '-show_format' in command
    assert '-show_streams' in command
    assert command[command.index('-v') + 1] == 'info'
    assert mock_run.call_args[1].get('keep_stderr') is True
    written = ''.join(str(c.args[0]) for c in manager.write.call_args_list)
    assert '4096' in written
    assert 'HTTP bytes read' in written


def test_is_frame_misaligned_accepts_url_and_headers():
    task = MagicMock()
    manager = MagicMock()
    frame_json = (
        '{"frames":[{"best_effort_timestamp_time":"0.0"},'
        '{"best_effort_timestamp_time":"0.033"}]}'
    )
    stderr = '[http @ 0x1] Statistics: 8192 bytes read, 0 seeks\n'

    with (
        patch.object(utils, 'ffprobe_supports_option_from_file', return_value=True),
        patch(
            'dive_tasks.frame_alignment.stream_subprocess', return_value=(frame_json, stderr)
        ) as mock_run,
    ):
        assert (
            is_frame_misaligned(
                task,
                'http://girder.example/api/v1/file/1/download',
                {},
                manager,
                headers='Girder-Token: tok\r\n',
            )
            is False
        )

    command = mock_run.call_args[0][3]['args']
    assert command[0] == 'ffprobe'
    assert '-/headers' in command
    assert '-headers' not in command
    assert 'tok' not in command[command.index('-/headers') + 1]
    assert 'http://girder.example/api/v1/file/1/download' in command
    written = ''.join(str(c.args[0]) for c in manager.write.call_args_list)
    assert '8192' in written


def _run_convert_video(task, **kwargs):
    """Invoke convert_video's underlying function with an explicit bound self."""
    from dive_tasks.convert_video import convert_video

    # PromiseProxy.__wrapped__ is a bound method; call the unbound function.
    return convert_video.__wrapped__.__func__(task, **kwargs)


def test_convert_video_skip_path_avoids_download():
    """Remote probe + skippable media must not call downloadItem."""
    probe = {
        'streams': [
            {
                'codec_type': 'video',
                'codec_name': 'h264',
                'sample_aspect_ratio': '1:1',
                'avg_frame_rate': '30/1',
                'r_frame_rate': '30/1',
            }
        ],
        'format': {'format_name': 'mov,mp4,m4a,3gp,3g2,mj2'},
    }

    task = MagicMock()
    task.canceled = False
    gc = MagicMock()
    gc.urlBase = 'http://girder.example/api/v1/'
    gc.token = 'tok-123'
    gc.getItem.return_value = {'name': 'clip.mp4'}
    gc.listFile.return_value = iter([{'_id': 'file1', 'name': 'clip.mp4'}])
    task.girder_client = gc
    task.job_manager = MagicMock()

    with (
        patch('dive_tasks.convert_video.patch_manager') as patch_mgr,
        patch('dive_tasks.convert_video.utils.ffprobe_format_and_streams', return_value=probe),
        patch('dive_tasks.convert_video.is_frame_misaligned', return_value=False),
        patch('dive_tasks.convert_video.resolve_annotation_fps', return_value=30.0),
    ):
        patch_mgr.return_value = MagicMock()
        _run_convert_video(
            task,
            folderId='folder1',
            itemId='item1',
            user_id='user1',
            user_login='alice',
            skip_transcoding=True,
        )

    gc.downloadItem.assert_not_called()
    gc.listFile.assert_called()
    gc.addMetadataToItem.assert_called_once()
    gc.addMetadataToFolder.assert_called_once()
    item_meta = gc.addMetadataToItem.call_args[0][1]
    assert item_meta['codec'] == 'h264'
    folder_meta = gc.addMetadataToFolder.call_args[0][1]
    assert folder_meta['annotate'] is True


def test_convert_video_downloads_when_transcode_required():
    probe = {
        'streams': [
            {
                'codec_type': 'video',
                'codec_name': 'mpeg4',
                'sample_aspect_ratio': '1:1',
                'avg_frame_rate': '25/1',
                'r_frame_rate': '25/1',
            }
        ],
        'format': {'format_name': 'avi'},
    }

    task = MagicMock()
    task.canceled = False
    gc = MagicMock()
    gc.urlBase = 'http://girder.example/api/v1/'
    gc.token = 'tok-123'
    gc.getItem.return_value = {'name': 'clip.avi'}
    gc.listFile.return_value = iter([{'_id': 'file1', 'name': 'clip.avi'}])
    gc.uploadFileToFolder.return_value = {'itemId': 'new-item'}
    task.girder_client = gc
    task.job_manager = MagicMock()

    with (
        patch('dive_tasks.convert_video.patch_manager') as patch_mgr,
        patch('dive_tasks.convert_video.utils.ffprobe_format_and_streams', return_value=probe),
        patch('dive_tasks.convert_video.is_frame_misaligned', return_value=False),
        patch('dive_tasks.convert_video.utils.stream_subprocess'),
        patch(
            'dive_tasks.convert_video.check_and_fix_frame_alignment',
            side_effect=lambda task, path, context, manager: path,
        ),
        patch('dive_tasks.convert_video.resolve_annotation_fps', return_value=25.0),
    ):
        patch_mgr.return_value = MagicMock()
        _run_convert_video(
            task,
            folderId='folder1',
            itemId='item1',
            user_id='user1',
            user_login='alice',
            skip_transcoding=True,
        )

    gc.downloadItem.assert_called_once()
    gc.uploadFileToFolder.assert_called_once()


def test_convert_video_cancel_during_remote_probe_does_not_download():
    """CanceledError from remote ffprobe must abort, not fall back to download."""
    task = MagicMock()
    task.canceled = False
    gc = MagicMock()
    gc.urlBase = 'http://girder.example/api/v1/'
    gc.token = 'tok-123'
    gc.getItem.return_value = {'name': 'clip.mp4'}
    gc.listFile.return_value = iter([{'_id': 'file1', 'name': 'clip.mp4'}])
    task.girder_client = gc
    task.job_manager = MagicMock()

    with (
        patch('dive_tasks.convert_video.patch_manager') as patch_mgr,
        patch(
            'dive_tasks.convert_video.utils.ffprobe_format_and_streams',
            side_effect=CanceledError('Job was canceled'),
        ),
    ):
        patch_mgr.return_value = MagicMock()
        # Outer suppress(CanceledError) swallows the re-raised cancel.
        _run_convert_video(
            task,
            folderId='folder1',
            itemId='item1',
            user_id='user1',
            user_login='alice',
            skip_transcoding=True,
        )

    gc.downloadItem.assert_not_called()
    gc.addMetadataToItem.assert_not_called()


def test_convert_video_cancel_during_remote_alignment_does_not_download():
    probe = {
        'streams': [
            {
                'codec_type': 'video',
                'codec_name': 'h264',
                'sample_aspect_ratio': '1:1',
                'avg_frame_rate': '30/1',
                'r_frame_rate': '30/1',
            }
        ],
        'format': {'format_name': 'mp4'},
    }

    task = MagicMock()
    task.canceled = False
    gc = MagicMock()
    gc.urlBase = 'http://girder.example/api/v1/'
    gc.token = 'tok-123'
    gc.getItem.return_value = {'name': 'clip.mp4'}
    gc.listFile.return_value = iter([{'_id': 'file1', 'name': 'clip.mp4'}])
    task.girder_client = gc
    task.job_manager = MagicMock()

    with (
        patch('dive_tasks.convert_video.patch_manager') as patch_mgr,
        patch('dive_tasks.convert_video.utils.ffprobe_format_and_streams', return_value=probe),
        patch(
            'dive_tasks.convert_video.is_frame_misaligned',
            side_effect=CanceledError('Job was canceled'),
        ),
    ):
        patch_mgr.return_value = MagicMock()
        _run_convert_video(
            task,
            folderId='folder1',
            itemId='item1',
            user_id='user1',
            user_login='alice',
            skip_transcoding=True,
        )

    gc.downloadItem.assert_not_called()
    gc.addMetadataToItem.assert_not_called()


def test_stream_subprocess_redacts_headers_in_job_log():
    task = MagicMock()
    task.canceled = False
    manager = MagicMock()
    manager.status = None

    utils.stream_subprocess(
        task,
        {},
        manager,
        {
            'args': [
                'bash',
                '-c',
                'exit 0',
                '-headers',
                'Girder-Token: secret\r\n',
            ]
        },
    )
    written = ''.join(str(c.args[0]) for c in manager.write.call_args_list)
    assert 'Running command:' in written
    assert 'secret' not in written
    assert '<redacted>' in written
