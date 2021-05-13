import shutil
import signal
from datetime import datetime, timedelta
from pathlib import Path
from subprocess import Popen
from tempfile import mktemp
from typing import IO, Callable, List, Optional

from girder_client import GirderClient
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_utils import fromMeta
from dive_utils.constants import ImageSequenceType, TypeMarker, VideoType
from dive_utils.types import GirderModel

TIMEOUT_COUNT = 'timeout_count'
TIMEOUT_LAST_CHECKED = 'last_checked'
TIMEOUT_CHECK_INTERVAL = 30


def check_canceled(task: Task, context: dict, force=True):
    """
    Only check for canceled task every interval unless force is true (default).
    This is an expensive operation that round-trips to the message broker.
    """
    if not context.get(TIMEOUT_COUNT):
        context[TIMEOUT_COUNT] = 0
    now = datetime.now()
    if (
        (now - context.get(TIMEOUT_LAST_CHECKED, now))
        > timedelta(seconds=TIMEOUT_CHECK_INTERVAL)
    ) or force:
        context[TIMEOUT_LAST_CHECKED] = now
        try:
            return task.canceled
        except TimeoutError as err:
            context[TIMEOUT_COUNT] += 1
            print(
                f"Timeout N={context[TIMEOUT_COUNT]} for this task when checking for cancellation. {err}"
            )
    return False


def stream_subprocess(
    process: Popen,
    task: Task,
    context: dict,
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

        if check_canceled(task, context, force=False):
            # Can never be sure what signal a process will respond to.
            process.send_signal(signal.SIGTERM)
            process.send_signal(signal.SIGKILL)

    # flush logs
    manager._flush()
    # Wait for exit up to 30 seconds after kill
    code = process.wait(30)

    if check_canceled(task, context):
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


def download_source_media(
    girder_client: GirderClient, folder: GirderModel, dest: Path
) -> List[str]:
    """
    Download source media for folder from girder
    """
    if fromMeta(folder, TypeMarker) == ImageSequenceType:
        image_items = girder_client.get(
            'viame/valid_images', {'folderId': folder["_id"]}
        )
        for item in image_items:
            girder_client.downloadItem(str(item["_id"]), str(dest))
        return [str(dest / item['name']) for item in image_items]
    elif fromMeta(folder, TypeMarker) == VideoType:
        clip_meta = girder_client.get(
            "viame_detection/clip_meta", {'folderId': folder['_id']}
        )
        destination_path = str(dest / clip_meta['video']['name'])
        girder_client.downloadFile(str(clip_meta['video']['_id']), destination_path)
        return [destination_path]
    else:
        raise Exception(f"unexpected folder {str(folder)}")
