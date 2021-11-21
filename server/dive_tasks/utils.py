from datetime import datetime, timedelta
from pathlib import Path
import signal
import subprocess
from subprocess import Popen
import tempfile
from typing import List, Tuple
from urllib import request
from urllib.parse import urlencode, urljoin

from girder_client import GirderClient
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_utils import constants, models

TIMEOUT_COUNT = 'timeout_count'
TIMEOUT_LAST_CHECKED = 'last_checked'
TIMEOUT_CHECK_INTERVAL = 30


def make_directory(path: Path):
    path.mkdir(exist_ok=True, parents=True)
    return path


class CanceledError(RuntimeError):
    pass


def authenticate_urllib(gc: GirderClient):
    """Enable authenticated requests to girder backend using normal urllib"""
    opener = request.build_opener()
    opener.addheaders = [('Girder-Token', gc.token)]
    request.install_opener(opener)


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

    with tempfile.TemporaryFile() as stderr_file:
        manager.write(f"Running command: {str(popen_kwargs['args'])}\n", forceFlush=True)
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
            manager.write('\nCanceled during subprocess run.\n')
            manager.updateStatus(JobStatus.CANCELED)
            raise CanceledError('Job was canceled')

        if code > 0:
            stderr_file.seek(0)
            stderr = stderr_file.read().decode()
            raise RuntimeError(
                'Pipeline exited with nonzero status code {}: {}'.format(process.returncode, stderr)
            )
        else:
            end_time = datetime.now()
            manager.write(f"\nProcess completed in {str((end_time - start_time))}\n")

        return stdout


def download_revision_csv(gc: GirderClient, dataset_id: str, revision: int, path: Path):
    """Download CSV file for dataset @ revision"""
    args = {'folderId': dataset_id, 'revision': revision, 'excludeBelowThreshold': True}
    url = urljoin(urljoin(gc.urlBase, 'dive_annotation/export'), f'?{urlencode(args)}')
    request.urlretrieve(url, filename=path)


def download_source_media(
    girder_client: GirderClient, datasetId: str, dest: Path
) -> Tuple[List[str], str]:
    """Download media for dataset to dest path"""
    media = models.DatasetSourceMedia(**girder_client.get(f'dive_dataset/{datasetId}/media'))
    dataset = models.GirderMetadataStatic(**girder_client.get(f'dive_dataset/{datasetId}'))
    if dataset.type == constants.ImageSequenceType:
        for frameImage in media.imageData:
            girder_client.downloadItem(frameImage.id, str(dest))
        return [str(dest / image.filename) for image in media.imageData], dataset.type
    elif dataset.type == constants.VideoType and media.video is not None:
        destination_path = str(dest / media.video.filename)
        girder_client.downloadFile(media.video.id, destination_path)
        return [destination_path], dataset.type
    else:
        raise Exception(f"unexpected metadata {str(dataset.dict())}")
