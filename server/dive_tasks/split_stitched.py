"""Split stitched stereo media: keep one half of every frame in a camera folder."""

from contextlib import suppress
from pathlib import Path
import tempfile

from girder_client import GirderClient
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_tasks import utils
from dive_tasks.convert_video import resolve_annotation_fps
from dive_tasks.frame_alignment import check_and_fix_frame_alignment
from dive_tasks.manager import patch_manager
from dive_utils import constants

STITCHED_SIDES = ('left', 'right')


def stitched_crop_filter(side: str) -> str:
    """ffmpeg filter keeping one half of a side-by-side frame.

    Both halves share one width so the two cameras agree on frame size; an
    odd-width frame drops its middle column.
    """
    if side not in STITCHED_SIDES:
        raise ValueError(f'stitched side must be one of {STITCHED_SIDES}, got {side!r}')
    if side == 'left':
        return 'crop=trunc(iw/2):ih:0:0'
    return 'crop=trunc(iw/2):ih:iw-trunc(iw/2):0'


def _split_video(
    self: Task, gc, manager, context, folderId: str, item: dict, side: str, work: Path
):
    file_name = str(work / item['name'])
    gc.downloadItem(item['_id'], work, name=item['name'])
    jsoninfo = utils.ffprobe_format_and_streams(self, context, manager, file_name)
    videostream = [s for s in jsoninfo['streams'] if s['codec_type'] == 'video']
    originalFpsString, originalFps = utils.fps_from_ffprobe_stream(videostream[0])
    output_file_path = (work / item['name']).with_suffix('.transcoded.mp4')
    command = [
        'ffmpeg',
        '-i',
        file_name,
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '22',
        '-c:a',
        'aac',
        '-vf',
        f'{stitched_crop_filter(side)},scale=ceil(iw*sar/2)*2:ceil(ih/2)*2,setsar=1',
        str(output_file_path),
    ]
    utils.stream_subprocess(self, context, manager, {'args': command})
    aligned_file = check_and_fix_frame_alignment(self, output_file_path, context, manager)
    new_file = gc.uploadFileToFolder(folderId, aligned_file)
    gc.addMetadataToItem(
        new_file['itemId'],
        {
            'source_video': False,
            'transcoder': 'ffmpeg',
            constants.OriginalFPSMarker: originalFps,
            constants.OriginalFPSStringMarker: originalFpsString,
            'codec': 'h264',
        },
    )
    # The stitched source must not stay behind as this camera's source video.
    gc.delete(f"item/{item['_id']}")
    gc.addMetadataToFolder(
        folderId,
        {
            constants.DatasetMarker: True,
            constants.OriginalFPSMarker: originalFps,
            constants.OriginalFPSStringMarker: originalFpsString,
            constants.FPSMarker: resolve_annotation_fps(gc, folderId, native_fps=originalFps),
            'ffprobe_info': videostream[0],
        },
    )


def _split_image(
    self: Task, gc, manager, context, folderId: str, item: dict, side: str, work: Path
):
    name = item['name']
    source_dir = utils.make_directory(work / 'source')
    output_dir = utils.make_directory(work / 'output')
    gc.downloadItem(item['_id'], source_dir, name)
    output_name = name
    if not constants.safeImageRegex.search(name):
        output_name = '.'.join([*name.split('.')[:-1], 'png'])
    output_path = output_dir / output_name
    command = [
        'ffmpeg',
        '-i',
        str(source_dir / name),
        '-vf',
        stitched_crop_filter(side),
        '-q:v',
        '1',
        str(output_path),
    ]
    utils.stream_subprocess(self, context, manager, {'args': command})
    gc.delete(f"item/{item['_id']}")
    gc.uploadFileToFolder(folderId, output_path)
    (source_dir / name).unlink()
    output_path.unlink()


@app.task(bind=True, acks_late=True)
def split_stitched_media(self: Task, folderId: str, side: str, user_id: str, user_login: str):
    """
    Replace the stitched (side-by-side) media of a camera folder with the given
    half of every frame, in a web friendly format, and mark the folder ready.
    """
    context: dict = {}
    gc: GirderClient = self.girder_client
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return
    stitched_crop_filter(side)

    items = list(gc.listItem(folderId))
    videos = [item for item in items if constants.videoRegex.search(item['name'])]
    images = [item for item in items if constants.imageRegex.search(item['name'])]

    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        work = Path(_working_directory)
        manager.updateStatus(JobStatus.RUNNING)
        for item in videos:
            manager.write(f"Splitting {item['name']} ({side} half)\n")
            _split_video(self, gc, manager, context, str(folderId), item, side, work)
        for item in images:
            _split_image(self, gc, manager, context, str(folderId), item, side, work)
        if images:
            gc.addMetadataToFolder(
                str(folderId),
                {
                    constants.DatasetMarker: True,
                    constants.FPSMarker: resolve_annotation_fps(gc, folderId),
                },
            )
