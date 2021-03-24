import shutil
import signal
from datetime import datetime
from pathlib import Path
from subprocess import Popen
from tempfile import mktemp
from typing import IO, Callable, Optional

from girder_client import GirderClient
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_utils import asbool, fromMeta


def stream_subprocess(
    process: Popen,
    task: Task,
    manager: JobManager,
    stderr_file: IO[bytes],
    keep_stdout: bool = False,
    cleanup: Optional[Callable] = None,
) -> str:
    """
    Stream live results from process to job manager

    :param process: Process to stream
    :param task: task to detect cancelation
    :param manager: job manager
    :param stderr_file: will log stderr to manager IF nonzero exit, else will close
    :param keep_stdout: will return stdout as a string if needed
    :param cleanup: a function to invoke if job errors or is canceled
    """
    start_time = datetime.now()
    stdout = ""

    if process.stdout is None:
        raise RuntimeError("Stdout must not be none")

    # call readline until it returns empty bytes
    for line in iter(process.stdout.readline, b''):
        line_str = line.decode('utf-8')
        manager.write(line_str)
        if keep_stdout:
            stdout += line_str
        if task.canceled:
            # Can never be sure what signal a process will respond to.
            process.send_signal(signal.SIGTERM)
            process.send_signal(signal.SIGKILL)
            break

    # flush logs
    manager._flush()
    # Wait for exit up to 30 seconds after kill
    code = process.wait(30)

    if task.canceled:
        manager.write('\nCanceled during subprocess run.\n')
        manager.updateStatus(JobStatus.CANCELED)
        stderr_file.close()
        if cleanup:
            cleanup()
        return stdout

    if code > 0:
        stderr_file.seek(0)
        stderr = stderr_file.read().decode()
        stderr_file.close()
        if cleanup:
            cleanup()
        raise RuntimeError(
            'Pipeline exited with nonzero status code {}: {}'.format(
                process.returncode, stderr
            )
        )
    else:
        end_time = datetime.now()
        manager.write(f"\nProcess completed in {str((end_time - start_time))}\n")

    stderr_file.close()

    return stdout


def organize_folder_for_training(data_dir: Path, downloaded_groundtruth: Path):
    """
    Organize directory downloaded from girder into a structure compatible with Viame.

    Relevant documentation:
    https://viame.readthedocs.io/en/latest/section_links/object_detector_training.html
    """

    if downloaded_groundtruth.is_dir():
        files = list(downloaded_groundtruth.glob("*.csv"))

        if not files:
            raise Exception("No csv groundtruth files found.")

        groundtruth_file = files[0]
        temp_file = downloaded_groundtruth.parent / mktemp()

        # Replace directory with file of same name
        shutil.copyfile(groundtruth_file, temp_file)
        shutil.rmtree(downloaded_groundtruth)
        shutil.move(str(temp_file), downloaded_groundtruth)

    groundtruth = data_dir / "groundtruth.csv"
    shutil.move(str(downloaded_groundtruth), groundtruth)

    return groundtruth


def get_video_filename(folderId: str, girder_client: GirderClient) -> Optional[str]:
    """
    Searches a folderId for videos that are compatible with training/pipelines

    * look for {"codec": 'h264', "source_video": False | None }, a transcoded video
    * then fall back to {"source_video": True}, the user uploaded video
    * If neither found it will return None

    :folderId: Current path to where the items sit
    :girder_client: girder_client used to request the data
    """
    folder_contents = girder_client.listItem(folderId)
    backup_converted_file = None
    for item in folder_contents:
        file_name = item.get("name")
        if asbool(fromMeta(item, "source_video")):
            backup_converted_file = file_name
        elif fromMeta(item, "codec") == "h264":
            return file_name
    return backup_converted_file
