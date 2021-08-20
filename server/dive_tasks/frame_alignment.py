import contextlib
import json
import os
import subprocess
from subprocess import Popen
import tempfile
from typing import Dict

from girder_worker.task import Task
from girder_worker.utils import JobManager

from dive_tasks.utils import check_canceled, stream_subprocess


def check_and_fix_frame_alignment(self: Task, output_path: str, context: Dict, manager: JobManager):
    """
    Some videos have a misalignment between their audio and video and during the
    transcoding process this results in duplicate initial video frames when viewed
    through the browser.
    This process will use ffprobe to check frame times and see if there are duplicate
    frames within the first 5 seconds.
    There appears to be no ffprobe way to determine if the second pass
     fixed the issue or not
    """
    misaligned = ffprobe_frame_alignment(self, output_path, context, manager)
    if misaligned is True:
        aligned_file = realign_video_and_audio(self, output_path, context, manager)
        if aligned_file is not None:
            return aligned_file
    return output_path


def ffprobe_frame_alignment(self: Task, output_path: str, context: Dict, manager: JobManager):
    process_err_file = tempfile.TemporaryFile()
    process = Popen(
        [
            "ffprobe",
            output_path,
            "-hide_banner",
            "-read_intervals",
            "%+5",
            "-show_entries",
            "frame=best_effort_timestamp_time",
            "-print_format",
            "json",
        ],
        stdout=subprocess.PIPE,
        stderr=process_err_file,
    )

    stdout = stream_subprocess(process, self, context, manager, process_err_file, keep_stdout=True)
    if check_canceled(self, context):
        return
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


def realign_video_and_audio(self: Task, output_path: str, context: Dict, manager: JobManager):
    with tempfile.NamedTemporaryFile(suffix="aligned.mp4", delete=True) as temp:
        aligned_file = temp.name

    def cleanup():
        with contextlib.supprealigned_filess(FileNotFoundError):
            os.remove(output_path)

    process_err_file = tempfile.TemporaryFile()
    process = Popen(
        [
            "ffmpeg",
            "-i",
            output_path,
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
            aligned_file,
        ],
        stdout=subprocess.PIPE,
        stderr=process_err_file,
    )
    stream_subprocess(process, self, context, manager, process_err_file, cleanup=cleanup)
    if check_canceled(self, context):
        return
    return aligned_file
