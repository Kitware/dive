import json
from pathlib import Path
from typing import Dict, Optional, Union

from girder_worker.task import Task
from girder_worker.utils import JobManager

from dive_tasks.utils import ffprobe_header_args, log_ffprobe_http_bytes, stream_subprocess

MediaSource = Union[Path, str]


def check_and_fix_frame_alignment(
    task: Task, file_path: Path, context: Dict, manager: JobManager
) -> Path:
    """
    Some videos have a misalignment between their audio and video and during the
    transcoding process this results in duplicate initial video frames when viewed
    through the browser.
    This process will use ffprobe to check frame times and see if there are duplicate
    frames within the first 5 seconds.
    There appears to be no ffprobe way to determine if the second pass
     fixed the issue or not
    """
    misaligned = is_frame_misaligned(task, file_path, context, manager)
    if misaligned is True:
        return _realign_video_and_audio(task, file_path, context, manager)
    return file_path


def is_frame_misaligned(
    task: Task,
    input_source: MediaSource,
    context: Dict,
    manager: JobManager,
    *,
    headers: Optional[str] = None,
) -> bool:
    """
    Return True if the first ~5s of frames contain duplicate timestamps.

    *input_source* may be a local Path or an HTTP(S) URL. Pass *headers* (e.g.
    ``girder_auth_headers(token)``) when probing a Girder download URL so ffprobe
    can authenticate and use Range requests. Auth prefers ``-/headers`` (temp file)
    so the token is not in process argv on modern ffprobe.
    """
    probe_tail = [
        str(input_source),
        '-hide_banner',
        '-read_intervals',
        '%+5',
        '-show_entries',
        'frame=best_effort_timestamp_time',
        '-print_format',
        'json',
    ]

    def _run(command):
        if headers:
            stdout, stderr = stream_subprocess(
                task, context, manager, {'args': command}, keep_stdout=True, keep_stderr=True
            )
            log_ffprobe_http_bytes(manager, stderr, label='ffprobe frame-alignment')
            return stdout
        return stream_subprocess(task, context, manager, {'args': command}, keep_stdout=True)

    if headers:
        # Emit HTTP Statistics so the job log can report bytes read.
        with ffprobe_header_args(headers) as header_args:
            stdout = _run(['ffprobe', *header_args, '-v', 'info', *probe_tail])
    else:
        stdout = _run(['ffprobe', *probe_tail])
    framejsoninfo = json.loads(stdout)
    if 'frames' not in framejsoninfo:
        raise Exception('Could not read ffprobe frames')
    frame_data = framejsoninfo['frames']
    previous_TS = -1
    for frame in frame_data:
        if 'best_effort_timestamp_time' in frame:
            current_TS = frame['best_effort_timestamp_time']
            if previous_TS != -1 and previous_TS == current_TS:
                return True
            previous_TS = current_TS
    return False


def _realign_video_and_audio(
    task: Task, file_path: Path, context: Dict, manager: JobManager
) -> Path:
    aligned_path = (file_path.parent / file_path.name).with_suffix('.aligned.mp4')
    command = [
        "ffmpeg",
        "-i",
        str(file_path),
        "-ss",
        "0",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        # lossless secondary encoding
        "-crf",
        "18",
        "-c:a",
        "copy",
        str(aligned_path),
    ]
    stream_subprocess(task, context, manager, {'args': command})
    return aligned_path
