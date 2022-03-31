from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import shutil
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
            destination_path = dest / frameImage.filename
            url = urljoin(girder_client.urlBase, frameImage.url)
            request.urlretrieve(url, filename=destination_path)
        return [str(dest / image.filename) for image in media.imageData], dataset.type
    elif dataset.type == constants.VideoType and media.video is not None:
        destination_path = str(dest / media.video.filename)
        url = urljoin(girder_client.urlBase, media.video.url)
        request.urlretrieve(url, filename=destination_path)
        return [destination_path], dataset.type
    else:
        raise Exception(f"unexpected metadata {str(dataset.dict())}")


def upload_zipped_flat_media_files(
    gc: GirderClient,
    manager: JobManager,
    folderId: str,
    working_directory: Path,
    create_subfolder=False,
):
    """Takes a flat folder of media files and/or annotation and generates a dataset from it"""
    listOfFileNames = os.listdir(working_directory)
    validation = gc.sendRestRequest('POST', '/dive_dataset/validate_files', json=listOfFileNames)
    root_folderId = folderId
    default_fps = gc.getFolder(root_folderId).get(f"meta.{constants.FPSMarker}", -1)
    if validation.get('ok', False):
        manager.write(f"Annotations: {validation['annotations']}\n")
        manager.write(f"Media: {validation['media']}\n")
        dataset_type = validation['type']
        manager.write(f"Type: {dataset_type}\n")
        if create_subfolder != '':
            sub_folder = gc.createFolder(
                folderId,
                create_subfolder,
                reuseExisting=True,
            )
            root_folderId = str(sub_folder["_id"])

        # Upload all resulting items back into the root folder
        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        # create a source folder to place the zipFile inside of
        gc.upload(f'{working_directory}/*', root_folderId)
        if dataset_type == constants.ImageSequenceType and default_fps == -1:
            default_fps = 1
        gc.addMetadataToFolder(
            str(root_folderId),
            {constants.TypeMarker: dataset_type, constants.FPSMarker: default_fps},
        )
        # After uploading the default files we do a the postprocess for video conversion now
        gc.sendRestRequest("POST", f"/dive_rpc/postprocess/{str(root_folderId)}")
    else:
        manager.write(f"Message: {validation['message']}\n")
        manager.write(
            "Please check the documentation for Zip files at:\
                 https://kitware.github.io/dive/Web-Version/#zip-files\n"
        )
        raise Exception("Could not Validate media Files")


def upload_exported_zipped_dataset(
    gc: GirderClient,
    manager: JobManager,
    folderId: str,
    working_directory: Path,
    create_subfolder='',
):
    """Uploads a folder that is generated from the export of a zip file and sets metadata"""
    listOfFileNames = os.listdir(working_directory)
    potential_meta_files = list(filter(constants.metaRegex.match, listOfFileNames))
    if len(potential_meta_files) == 0:
        manager.write("Could not find meta.json or config.json file within the subdirectroy\n")
        return
    print(listOfFileNames)
    # load meta.json to get datatype and verify list of files
    meta = {}
    for meta_name in potential_meta_files:
        with open(f"{working_directory}/{meta_name}") as f:
            meta = json.load(f)
    type = meta[constants.TypeMarker]
    if type == constants.ImageSequenceType:
        imageData = meta['imageData']
        for image in imageData:
            if image["filename"] not in listOfFileNames:
                manager.write(f"Could not find {image['filename']} file within the list of files\n")
                return
    elif type == constants.VideoType:
        video = meta["video"]
        if video["filename"] not in listOfFileNames:
            manager.write(f"Could not find {video['filename']} file within the list of files\n")
            return
    # remove the auxilary directory so we don't have to tag them all
    if constants.AuxiliaryFolderName in listOfFileNames and os.path.isdir(
        f'{working_directory}/{constants.AuxiliaryFolderName}'
    ):
        shutil.rmtree(f'{working_directory}/{constants.AuxiliaryFolderName}')
    root_folderId = folderId
    if create_subfolder != '':
        sub_folder = gc.createFolder(
            folderId,
            create_subfolder,
            reuseExisting=True,
        )
        root_folderId = str(sub_folder['_id'])
        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        # create a source folder to place the zipFile inside of
    gc.upload(f'{working_directory}/*', root_folderId)
    # Now we set all the metadata for the folders and items
    all_files = list(gc.listItem(root_folderId))
    root_meta = {
        "type": type,
        "attributes": meta.get("attributes", None),
        "customTypeStyling": meta.get("customTypeStyling", None),
        "confidenceFilters": meta.get("confidenceFilters", None),
        "fps": meta["fps"],
        "version": meta["version"],
    }
    if type == constants.VideoType:
        # set transcoded and non-transcoded versions
        transcoded_video = list(gc.listItem(root_folderId, name=video["filename"]))
        if len(transcoded_video) == 1:
            ffprobe = meta["ffprobe_info"]
            avgFpsString = ffprobe["avg_frame_rate"]
            dividend, divisor = [int(v) for v in avgFpsString.split('/')]
            originalFps = dividend / divisor

            transcoded_metadata = {
                "codec": "h264",
                "originalFps": originalFps,
                "originalFpsString": avgFpsString,
                "source_video": False,
                "transcoder": "ffmpeg",
            }
            gc.addMetadataToItem(str(transcoded_video[0]['_id']), transcoded_metadata)
            # other video is tagged as the source video
            for item in all_files:
                if (
                    item["name"].endswith(tuple(constants.validVideoFormats))
                    and item["name"] != video["filename"]
                ):
                    source_metadata = {
                        "codec": ffprobe["codec_name"],
                        "originalFps": originalFps,
                        "originalFpsString": avgFpsString,
                        "source_video": False,
                    }
                    gc.addMetadataToItem(str(item['_id']), source_metadata)
            root_meta["originalFps"] = originalFps
            root_meta["originalFpsString"] = avgFpsString

    # Need to tag folder Level data (annotate, and others)
    root_meta[constants.DatasetMarker] = True
    gc.addMetadataToFolder(root_folderId, root_meta)
    gc.post(f'dive_rpc/postprocess/{root_folderId}', data={"skipJobs": True})
