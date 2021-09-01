import json
from pathlib import Path
from typing import Dict

from girder_worker.task import Task
from girder_worker.utils import JobManager

from dive_tasks.utils import stream_subprocess


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
    misaligned = _ffprobe_frame_alignment(task, file_path, context, manager)
    if misaligned is True:
        return _realign_video_and_audio(task, file_path, context, manager)
    return file_path


def _ffprobe_frame_alignment(
    task: Task, file_path: Path, context: Dict, manager: JobManager
) -> bool:
    command = [
        "ffprobe",
        str(file_path),
        "-hide_banner",
        "-read_intervals",
        "%+5",
        "-show_entries",
        "frame=best_effort_timestamp_time",
        "-print_format",
        "json",
    ]
    stdout = stream_subprocess(task, context, manager, {'args': command}, keep_stdout=True)
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
