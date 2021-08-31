from datetime import datetime, timedelta
from pathlib import Path
import shutil
import signal
import subprocess
from subprocess import Popen
import tempfile
from tempfile import mktemp
from typing import List

from girder_client import GirderClient
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_utils import constants, models

TIMEOUT_COUNT = 'timeout_count'
TIMEOUT_LAST_CHECKED = 'last_checked'
TIMEOUT_CHECK_INTERVAL = 30


class CanceledError(RuntimeError):
    pass


def check_canceled(task: Task, context: dict, force=True):
    """
    Only check for canceled task every interval unless force is true (default).
    This is an expensive operation that round-trips to the message broker.
    """
    if not context.get(TIMEOUT_COUNT):
        context[TIMEOUT_COUNT] = 0
    now = datetime.now()
    if (
        (now - context.get(TIMEOUT_LAST_CHECKED, now)) > timedelta(seconds=TIMEOUT_CHECK_INTERVAL)
    ) or force:
        context[TIMEOUT_LAST_CHECKED] = now
        try:
            return task.canceled
        except (TimeoutError, ConnectionError) as err:
            context[TIMEOUT_COUNT] += 1
            print(
                f"Timeout N={context[TIMEOUT_COUNT]} for this task when checking for "
                f"cancellation. {err}"
            )
    return False


def stream_subprocess(
    task: Task,
    context: dict,
    manager: JobManager,
    popen_kwargs: dict,
    keep_stdout: bool = False,
) -> str:
    """
    Stream live results from process to job manager

    :param task: task to detect cancelation
    :param manager: job manager
    :param popen_kwargs: a dict to pass as kwargs to popen.  Must include 'args'
    :param keep_stdout: will return stdout as a string if needed
    """
    start_time = datetime.now()
    stdout = ""

    assert 'args' in popen_kwargs, "popen_kwargs must contain key 'args'"

    manager.write(f"Running command: {str(popen_kwargs['args'])}\n", forceFlush=True)
    stderr_file = tempfile.TemporaryFile()
    process = Popen(
        **popen_kwargs,
        stdout=subprocess.PIPE,
        stderr=stderr_file,
    )

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
        stderr_file.close()
        manager.write('\nCanceled during subprocess run.\n')
        manager.updateStatus(JobStatus.CANCELED)
        raise CanceledError('Job was canceled')

    if code > 0:
        stderr_file.seek(0)
        stderr = stderr_file.read().decode()
        stderr_file.close()
        raise RuntimeError(
            'Pipeline exited with nonzero status code {}: {}'.format(process.returncode, stderr)
        )
    else:
        stderr_file.close()
        end_time = datetime.now()
        manager.write(f"\nProcess completed in {str((end_time - start_time))}\n")

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


def download_source_media(girder_client: GirderClient, datasetId: str, dest: Path) -> List[str]:
    """Download media for dataset to dest path"""
    media = models.DatasetSourceMedia(**girder_client.get(f'dive_dataset/{datasetId}/media'))
    dataset = models.GirderMetadataStatic(**girder_client.get(f'dive_dataset/{datasetId}'))
    if dataset.type == constants.ImageSequenceType:
        for frameImage in media.imageData:
            girder_client.downloadItem(frameImage.id, str(dest))
        return [str(dest / image.filename) for image in media.imageData]
    elif dataset.type == constants.VideoType and media.video is not None:
        destination_path = str(dest / media.video.filename)
        girder_client.downloadFile(media.video.id, destination_path)
        return [destination_path]
    else:
        raise Exception(f"unexpected metadata {str(dataset.dict())}")
