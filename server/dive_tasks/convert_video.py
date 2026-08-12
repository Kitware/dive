from contextlib import suppress
from pathlib import Path
import tempfile
from typing import Optional

from girder_client import GirderClient
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_tasks import utils
from dive_tasks.frame_alignment import check_and_fix_frame_alignment, is_frame_misaligned
from dive_tasks.manager import patch_manager
from dive_utils import constants, fromMeta
from dive_utils.types import GirderModel


def resolve_annotation_fps(
    gc: GirderClient,
    folder_id: str,
    *,
    native_fps: Optional[float] = None,
    default_fps: float = 1.0,
) -> float:
    """Pick annotation FPS from current folder meta vs media FPS.

    Re-reads folder ``fps`` so a concurrent CSV import (assetstore postprocess)
    is not overwritten by a stale ``-1`` snapshot from job start.

    For video, pass ``native_fps`` from ffprobe. For image sequences, omit it so
    ``-1`` falls back to ``default_fps`` (1) and any CSV-set value is kept.
    """
    requested_fps = fromMeta(gc.getFolder(folder_id), constants.FPSMarker)
    return utils.choose_annotation_fps(
        requested_fps, native_fps=native_fps, default_fps=default_fps
    )


def _download_video_item(
    gc: GirderClient,
    manager: JobManager,
    item_id: str,
    item_name: str,
    dest_dir: Path,
) -> str:
    """Download a Girder video item to *dest_dir*; return the local file path."""
    file_name = str(dest_dir / item_name)
    manager.updateStatus(JobStatus.FETCHING_INPUT)
    manager.write(f'Fetching input from {item_id} to {file_name}...\n')
    gc.downloadItem(item_id, dest_dir, name=item_name)
    return file_name


@app.task(bind=True, acks_late=True, ignore_result=True)
def convert_video(
    self: Task, folderId: str, itemId: str, user_id: str, user_login: str, skip_transcoding=False
):
    context: dict = {}
    gc: GirderClient = self.girder_client
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        _working_directory_path = Path(_working_directory)
        item: GirderModel = gc.getItem(itemId)
        item_name = item['name']
        output_file_path = (_working_directory_path / item_name).with_suffix('.transcoded.mp4')

        # When skip_transcoding is requested, probe via authenticated HTTP Range
        # requests first so web-ready S3/filesystem videos never need a full download.
        # Fall back to downloading the whole object if remote probe/alignment fails.
        jsoninfo = None
        file_name: Optional[str] = None
        auth_headers: Optional[str] = None
        remote_url: Optional[str] = None

        if skip_transcoding:
            try:
                remote_url = utils.item_primary_file_download_url(gc, itemId)
            except Exception as exc:
                manager.write(
                    f'Could not resolve file download URL ({exc}); '
                    'falling back to full download\n'
                )
                remote_url = None
            if remote_url is not None:
                auth_headers = utils.girder_auth_headers(gc.token)
                manager.updateStatus(JobStatus.RUNNING)
                manager.write(f'Probing video via HTTP Range requests: {remote_url}\n')
                try:
                    jsoninfo = utils.ffprobe_format_and_streams(
                        self, context, manager, remote_url, headers=auth_headers
                    )
                except utils.CanceledError:
                    raise
                except Exception as exc:
                    manager.write(f'Remote ffprobe failed ({exc}); falling back to full download\n')
                    jsoninfo = None
                    auth_headers = None
                    remote_url = None

        if jsoninfo is None:
            file_name = _download_video_item(
                gc, manager, itemId, item_name, _working_directory_path
            )
            manager.updateStatus(JobStatus.RUNNING)
            jsoninfo = utils.ffprobe_format_and_streams(self, context, manager, file_name)

        videostream = list(filter(lambda x: x["codec_type"] == "video", jsoninfo["streams"]))
        if len(videostream) != 1:
            print('Expected 1 video stream, found {}'.format(len(videostream)))
            print('Using first Video Stream found')

        format_info = jsoninfo.get('format') or {}
        format_name = format_info.get('format_name') or ''

        # Extract framerate (avg_frame_rate, else r_frame_rate for e.g. MPEG-TS)
        originalFpsString, originalFps = utils.fps_from_ffprobe_stream(videostream[0])

        source_misaligned = False
        if skip_transcoding:
            alignment_source: Optional[str] = file_name or remote_url
            alignment_headers = auth_headers if file_name is None else None
            try:
                source_misaligned = is_frame_misaligned(
                    self,
                    alignment_source,
                    context,
                    manager,
                    headers=alignment_headers,
                )
            except utils.CanceledError:
                raise
            except Exception as exc:
                if file_name is None:
                    manager.write(
                        f'Remote frame-alignment check failed ({exc}); '
                        'falling back to full download\n'
                    )
                    file_name = _download_video_item(
                        gc, manager, itemId, item_name, _working_directory_path
                    )
                    manager.updateStatus(JobStatus.RUNNING)
                    # Re-probe locally so metadata matches the file we will encode.
                    jsoninfo = utils.ffprobe_format_and_streams(self, context, manager, file_name)
                    videostream = list(
                        filter(lambda x: x["codec_type"] == "video", jsoninfo["streams"])
                    )
                    format_info = jsoninfo.get('format') or {}
                    format_name = format_info.get('format_name') or ''
                    originalFpsString, originalFps = utils.fps_from_ffprobe_stream(videostream[0])
                    source_misaligned = is_frame_misaligned(self, Path(file_name), context, manager)
                else:
                    raise

        # Skip remux/transcode only for browser-safe sources, matching desktop checks.
        can_skip_transcode = utils.can_skip_video_transcoding(
            skip_transcoding=skip_transcoding,
            codec_name=videostream[0]['codec_name'],
            sample_aspect_ratio=videostream[0].get('sample_aspect_ratio'),
            format_name=format_name,
            source_misaligned=source_misaligned,
        )

        # lets determine if we don't need to transcode this file
        if can_skip_transcode:
            # Now we can update the meta data and push the values
            manager.updateStatus(JobStatus.PUSHING_OUTPUT)
            if file_name is None:
                manager.write('Skip transcode: no full download required\n')
            newAnnotationFps = resolve_annotation_fps(gc, folderId, native_fps=originalFps)
            gc.addMetadataToItem(
                itemId,
                {
                    "source_video": False,  # even though it is, this for requesting
                    "transcoder": "ffmpeg",
                    constants.OriginalFPSMarker: originalFps,
                    constants.OriginalFPSStringMarker: originalFpsString,
                    "codec": "h264",
                },
            )
            gc.addMetadataToFolder(
                folderId,
                {
                    constants.DatasetMarker: True,  # mark the parent folder as able to annotate.
                    constants.OriginalFPSMarker: originalFps,
                    constants.OriginalFPSStringMarker: originalFpsString,
                    constants.FPSMarker: newAnnotationFps,
                    "ffprobe_info": videostream[0],
                },
            )
            return
        elif skip_transcoding:
            print('Transcoding cannot be skipped:')
            print(f'Codec Name: {videostream[0]["codec_name"]}')
            print(f'format_name: {format_name}')
            if videostream[0]['codec_name'] != 'h264':
                print('Codec is not h264; file will be transcoded')
            elif videostream[0].get('sample_aspect_ratio') != '1:1':
                print(
                    'Sample aspect ratio is not 1:1; file will be transcoded '
                    '(desktop-parity rule)'
                )
            elif not utils.container_allows_skip_transcoding(format_name):
                print('Container is not web-safe (e.g. mpegts); file will be transcoded')
            elif source_misaligned:
                print('Frame timestamps are misaligned; file will be transcoded')

        if file_name is None:
            file_name = _download_video_item(
                gc, manager, itemId, item_name, _working_directory_path
            )
            manager.updateStatus(JobStatus.RUNNING)

        command = [
            "ffmpeg",
            "-i",
            file_name,
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            # https://github.com/Kitware/dive/issues/855
            "-crf",
            "22",
            # https://askubuntu.com/questions/1315697/could-not-find-tag-for-codec-pcm-s16le-in-stream-1-codec-not-currently-support
            "-c:a",
            "aac",
            # see native/<platform> code for a discussion of this option
            "-vf",
            "scale=ceil(iw*sar/2)*2:ceil(ih/2)*2,setsar=1",
            str(output_file_path),
        ]
        utils.stream_subprocess(self, context, manager, {'args': command})
        # Check to see if frame alignment remains the same
        aligned_file = check_and_fix_frame_alignment(self, output_file_path, context, manager)
        misaligned_flag = False
        if aligned_file != output_file_path:
            misaligned_flag = True

        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        newAnnotationFps = resolve_annotation_fps(gc, folderId, native_fps=originalFps)
        new_file = gc.uploadFileToFolder(folderId, aligned_file)
        gc.addMetadataToItem(
            new_file['itemId'],
            {
                "source_video": False,
                "transcoder": "ffmpeg",
                constants.OriginalFPSMarker: originalFps,
                constants.OriginalFPSStringMarker: originalFpsString,
                "codec": "h264",
            },
        )
        source_metadata = {
            "source_video": True,
            constants.OriginalFPSMarker: originalFps,
            constants.OriginalFPSStringMarker: originalFpsString,
            "codec": videostream[0]["codec_name"],
        }
        if misaligned_flag:
            source_metadata[constants.MISALGINED_MARKER] = True
        gc.addMetadataToItem(
            itemId,
            source_metadata,
        )
        gc.addMetadataToFolder(
            folderId,
            {
                constants.DatasetMarker: True,  # mark the parent folder as able to annotate.
                constants.OriginalFPSMarker: originalFps,
                constants.OriginalFPSStringMarker: originalFpsString,
                constants.FPSMarker: newAnnotationFps,
                "ffprobe_info": videostream[0],
            },
        )
